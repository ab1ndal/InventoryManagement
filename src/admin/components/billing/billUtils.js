// Shared pricing utilities for billing components

export function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

export function money(n) {
  return "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
}

export function normalizeItem(it) {
  const alterGross = Number(it.alteration_charge || it.stitching_charge || 0);
  const alterPreTax = alterGross / 1.05; // alteration is always 5% GST-inclusive
  return {
    qty: Number(it.quantity || 1),
    mrp: Number(it.mrp || 0),
    quickDiscountPct: Number(it.quickDiscountPct || 0),
    alteration: alterPreTax,                    // pre-tax alteration
    alterGst: round2(alterGross - alterPreTax), // 5% GST on alteration
    gstRate: Number(it.gstRate ?? 18),
    stitchType: it.stitchType || 'unstitched',
  };
}

export function priceItem(it) {
  const { qty, mrp, quickDiscountPct, alteration, alterGst, gstRate, stitchType } =
    normalizeItem(it);
  const base = mrp * qty;
  const itemDisc = round2((base * quickDiscountPct) / 100);
  const afterDisc = base - itemDisc;
  const withCharges = afterDisc + alteration;         // total pre-tax (item + alter pre-tax)

  let effectiveGstRate = gstRate;
  if (stitchType === 'unstitched') {
    effectiveGstRate = 5;
  } else {
    const pricePerUnit = qty > 0 ? afterDisc / qty : 0;
    if (pricePerUnit > 0) {
      effectiveGstRate = pricePerUnit > 2500 ? 18 : 5;
    }
  }

  const itemGst = round2((afterDisc * effectiveGstRate) / 100);
  const gstAmt = round2(itemGst + alterGst);
  const total = round2(withCharges + gstAmt);
  return {
    base,
    alteration,
    alterGst,
    itemDisc,
    afterDisc,
    withCharges,
    subtotal: withCharges,
    gst_amount: gstAmt,
    gstRate: effectiveGstRate,
    total,
  };
}

export function computePreTaxBalanceDiscount(computed, targetGrandTotal) {
  if (targetGrandTotal >= computed.grandTotal || computed.taxableTotal <= 0) return 0;
  const weightedGstRate = computed.gstTotal / computed.taxableTotal;
  const reduction = computed.grandTotal - targetGrandTotal;
  return round2(Math.max(0, reduction / (1 + weightedGstRate)));
}

export function computeBillTotals(items, selectedCodes, allDiscounts, extraPreTaxDiscount = 0, voucherPreTax = 0) {
  const pricedItems = items.map(priceItem);

  // Face value: MRP total + quoted alteration charges (both as entered by user)
  const itemsSubtotal = round2(items.reduce((s, it) => {
    return s + Number(it.mrp || 0) * Number(it.quantity || 1)
             + Number(it.alteration_charge || it.stitching_charge || 0);
  }, 0));

  const itemLevelDiscountTotal = round2(pricedItems.reduce((s, p) => s + p.itemDisc, 0));
  const preOverallTaxable = round2(pricedItems.reduce((s, p) => s + p.withCharges, 0));

  const codes = selectedCodes || [];
  const discounts = allDiscounts || [];
  const overallDiscount = round2(applyOverallDiscounts(items, codes, discounts));
  const taxableTotal = Math.max(0, round2(preOverallTaxable - overallDiscount - extraPreTaxDiscount - voucherPreTax));

  const itemTaxables = pricedItems.map(p => p.withCharges);
  const totalTaxableBefore = preOverallTaxable || 1;

  const rawGst = round2(
    pricedItems.reduce((sum, p, idx) => {
      const it = items[idx];
      const share = itemTaxables[idx] / totalTaxableBefore;
      const reducedTaxable = taxableTotal * share;
      const qty = Number(it.quantity || 1);
      const stitchType = it.stitchType || 'unstitched';

      // Split reducedTaxable into item and alteration pre-tax portions
      const alterProp = p.withCharges > 0 ? p.alteration / p.withCharges : 0;
      const reducedAlterTaxable = reducedTaxable * alterProp;
      const reducedItemTaxable = reducedTaxable - reducedAlterTaxable;

      // GST rate: unstitched always 5%; stitched re-evaluates slab post-discount
      let rate = Number(it.gstRate ?? 18);
      if (stitchType === 'unstitched') {
        rate = 5;
      } else {
        const effectivePricePerUnit = qty > 0 ? reducedItemTaxable / qty : 0;
        if (effectivePricePerUnit > 0) {
          rate = effectivePricePerUnit > 2500 ? 18 : 5;
        }
      }

      return sum + round2((reducedItemTaxable * rate) / 100) + round2(reducedAlterTaxable * 0.05);
    }, 0)
  );

  const gstTotal = rawGst;
  const grandTotal = round2(taxableTotal + rawGst);

  return {
    itemsSubtotal,
    itemLevelDiscountTotal,
    preOverallTaxable,
    overallDiscount,
    taxableTotal,
    gstTotal,
    grandTotal,
    gstOffSavings: 0,
    balanceDiscount: round2(extraPreTaxDiscount),
    voucherPreTax: round2(voucherPreTax),
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

export function valueOfDiscount(d, items) {
  const total = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  if (Number(d.min_total || 0) > 0 && total < Number(d.min_total)) return 0;
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
    case "gst_off": {
      // Discount that absorbs GST: total GST across all items
      const gstOffAmt = round2(items.reduce((s, it) => s + priceItem(it).gst_amount, 0));
      return clampMax(gstOffAmt, d.max_discount);
    }
    default:
      return 0;
  }
}

function clampMax(v, m) {
  if (!m && m !== 0) return v;
  return Math.min(v, Number(m));
}
