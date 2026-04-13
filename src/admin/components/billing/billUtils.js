// Shared pricing utilities for billing components

export function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export function money(n) {
  return "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
}

export function normalizeItem(it) {
  return {
    qty: Number(it.quantity || 1),
    mrp: Number(it.mrp || 0),
    quickDiscountPct: Number(it.quickDiscountPct || 0),
    // alteration_charge is the single source of truth; stitching_charge is legacy
    alteration: Number(it.alteration_charge || it.stitching_charge || 0),
    gstRate: Number(it.gstRate ?? 18),
  };
}

export function priceItem(it) {
  const { qty, mrp, quickDiscountPct, alteration, gstRate } =
    normalizeItem(it);
  const base = mrp * qty;
  const itemDisc = round2((base * quickDiscountPct) / 100);
  const afterDisc = base - itemDisc;
  const withCharges = afterDisc + alteration;
  const gstAmt = round2((withCharges * gstRate) / 100);
  const total = round2(withCharges + gstAmt);
  return {
    base,
    alteration,
    itemDisc,
    afterDisc,
    withCharges,
    subtotal: withCharges,
    gst_amount: gstAmt,
    total,
  };
}

export function computeBillTotals(items, selectedCodes, allDiscounts) {
  const priced = items.map(priceItem);
  // Subtotal = MRP total + alteration charges, before any discounts or GST
  const itemsSubtotal = round2(priced.reduce((s, p) => s + p.base + p.alteration, 0));
  const itemLevelDiscountTotal = round2(
    priced.reduce((s, p) => s + p.itemDisc, 0)
  );
  const preOverallTaxable = round2(
    priced.reduce((s, p) => s + p.withCharges, 0)
  );

  const overallDiscount = round2(
    applyOverallDiscounts(items, selectedCodes, allDiscounts)
  );
  const taxableTotal = Math.max(0, round2(preOverallTaxable - overallDiscount));

  const itemTaxables = items.map((it) => priceItem(it).withCharges);
  const totalTaxableBefore = preOverallTaxable || 1;
  const gstTotal = round2(
    items.reduce((sum, it, idx) => {
      const share = itemTaxables[idx] / totalTaxableBefore;
      const reducedTaxable = taxableTotal * share;
      const rate = Number(it.gstRate ?? 18);
      return sum + round2((reducedTaxable * rate) / 100);
    }, 0)
  );

  const grandTotal = round2(taxableTotal + gstTotal);
  return {
    itemsSubtotal,
    itemLevelDiscountTotal,
    overallDiscount,
    taxableTotal,
    gstTotal,
    grandTotal,
  };
}

function applyOverallDiscounts(items, codes, allDiscounts) {
  if (!codes || codes.length === 0) return 0;
  const active = allDiscounts.filter((d) => codes.includes(d.code));
  if (active.length === 0) return 0;
  const exclusive = active.filter((d) => d.exclusive);
  if (exclusive.length > 0) {
    return Math.max(...exclusive.map((d) => valueOfDiscount(d, items)));
  }
  return active.reduce((sum, d) => sum + valueOfDiscount(d, items), 0);
}

/**
 * Identifies which item units are "free" in a buy_x_get_y discount.
 * Returns array of { itemIndex, unitPrice } for the cheapest eligible units.
 * Used by both valueOfDiscount (for amount) and InvoiceView (for FREE labels).
 */
export function getFreeItems(d, items) {
  if (d.type !== 'buy_x_get_y') return [];
  const r = d.rules || {};
  const buy = Number(r.buy_qty || 2);
  const get = Number(r.get_qty || 1);
  const eligible = [];
  items.forEach((it, itemIndex) => {
    if (matchesCategories(it, d)) {
      const p = priceItem(it);
      const unitPrice = p.withCharges / (it.quantity || 1);
      for (let i = 0; i < (it.quantity || 1); i++) {
        eligible.push({ itemIndex, unitPrice });
      }
    }
  });
  eligible.sort((a, b) => a.unitPrice - b.unitPrice);
  if (eligible.length < buy + get) return [];
  const group = Math.floor(eligible.length / (buy + get));
  return eligible.slice(0, group * get);
}

/**
 * Returns true if the item's category matches the discount's category filter.
 * Checks rules.categories (array) first, then rules.category / d.category (single).
 * If no category filter is set, all items match.
 */
function matchesCategories(it, d) {
  const r = d.rules || {};
  const cats = r.categories; // string[] from multi-select
  const itemCat = it.category || it.manual_category || null;
  if (cats && cats.length > 0) {
    return cats.includes(itemCat);
  }
  const single = r.category || d.category || null;
  if (single) return itemCat === single;
  return true; // no filter → all items
}

function valueOfDiscount(d, items) {
  const total = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  switch (d.type) {
    case "flat":
      return clampMax(Number(d.value || 0), d.max_discount);
    case "percentage": {
      const pct = Number(d.value || 0);
      return clampMax(round2((total * pct) / 100), d.max_discount);
    }
    case "buy_x_get_y": {
      const freeItems = getFreeItems(d, items);
      if (freeItems.length === 0) return 0;
      return clampMax(
        round2(freeItems.reduce((s, f) => s + f.unitPrice, 0)),
        d.max_discount
      );
    }
    case "fixed_price": {
      // Per-item fixed pricing: each qualifying item is repriced to rules.fixed_total.
      // Qualifying = matches category filter AND MRP is within [min_price, max_price] bounds.
      const r = d.rules || {};
      const fixedPerItem = Number(r.fixed_total || 0);
      const minPrice = r.min_price != null ? Number(r.min_price) : null;
      const maxPrice = r.max_price != null ? Number(r.max_price) : null;
      let totalDiscount = 0;
      items.forEach((it) => {
        if (!matchesCategories(it, d)) return;
        const mrp = Number(it.mrp || 0);
        if (minPrice !== null && mrp < minPrice) return;
        if (maxPrice !== null && mrp > maxPrice) return;
        const qty = Number(it.quantity || 1);
        const p = priceItem(it);
        const unitPrice = p.withCharges / qty;
        const disc = Math.max(0, unitPrice - fixedPerItem) * qty;
        totalDiscount += disc;
      });
      return clampMax(round2(totalDiscount), d.max_discount);
    }
    case "bundled_pricing": {
      // Customer buys bundle_qty items from qualifying categories at a fixed bundle_price.
      // Discount = sum of cheapest bundle_qty item units − bundle_price (if enough items exist).
      const r = d.rules || {};
      const bundleQty = Number(r.bundle_qty || 1);
      const bundlePrice = Number(r.bundle_price || 0);
      const eligible = [];
      items.forEach((it) => {
        if (!matchesCategories(it, d)) return;
        const p = priceItem(it);
        const unitPrice = p.withCharges / (it.quantity || 1);
        for (let i = 0; i < (it.quantity || 1); i++) {
          eligible.push(unitPrice);
        }
      });
      if (eligible.length < bundleQty) return 0;
      eligible.sort((a, b) => a - b);
      const bundleTotal = eligible.slice(0, bundleQty).reduce((s, p) => s + p, 0);
      return clampMax(round2(Math.max(0, bundleTotal - bundlePrice)), d.max_discount);
    }
    case "conditional": {
      const r = d.rules || {};
      const minTotal = Number(r.min_total || d.min_total || 0);
      const val = Number(r.value || d.value || 0);
      return total >= minTotal ? clampMax(val, d.max_discount) : 0;
    }
    default:
      return 0;
  }
}

function clampMax(v, m) {
  if (!m && m !== 0) return v;
  return Math.min(v, Number(m));
}
