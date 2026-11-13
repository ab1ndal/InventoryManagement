// Pure helper functions for stock delta computation and bill item payload building

import { priceItem, round2 } from "./billUtils.js";

/**
 * Compute a stock delta map between existing bill items and new inventory items.
 *
 * @param {Array<{variantid: string, quantity: number}>} existingBillItems - Items from DB (old bill_items)
 * @param {Array<{variantid: string, quantity: number}>} newInventoryItems - Items from form
 * @returns {Object} deltaMap where keys are variantid strings and values are integers.
 *   Positive delta = stock should increase (item removed), negative = stock should decrease (item added).
 *   Zero deltas are included; caller may skip them.
 *
 * For new drafts (no existing items), pass [] as existingBillItems.
 */
export function computeStockDelta(existingBillItems, newInventoryItems) {
  const deltaMap = {};

  // Restore stock for existing items (positive delta)
  for (const item of existingBillItems) {
    if (!item.variantid) continue;
    const vid = item.variantid;
    deltaMap[vid] = (deltaMap[vid] || 0) + Number(item.quantity);
  }

  // Subtract stock for new items (negative delta)
  for (const item of newInventoryItems) {
    if (!item.variantid) continue;
    const vid = item.variantid;
    deltaMap[vid] = (deltaMap[vid] || 0) - Number(item.quantity);
  }

  return deltaMap;
}

/**
 * Build the bill_items insert payload from BillingForm items.
 *
 * Alteration charges are treated as 5% GST-inclusive (as quoted to customer).
 * GST slab for stitched items is re-evaluated on the post-discount item price.
 *
 * @param {number} billid - The bill ID to associate items with
 * @param {Array} items - BillingForm item objects (must include stitchType)
 * @param {number} balanceDiscount - Pre-tax balance discount to distribute (explicit partial-finalize waiver)
 * @param {number} overallDiscount - Pre-tax overall discount to distribute
 * @param {string} docType
 * @returns {Array} Array of bill_items insert objects ready for Supabase insert
 */
/**
 * Why a new bill's stock request cannot be met, as one line per variant, or null when it can. Lines
 * are totalled per variant first: two lines of 4 from a stock of 5 must fail, though each fits alone.
 */
export function describeStockShortfalls(inventoryItems, stockMap) {
  const requested = new Map();
  for (const it of inventoryItems) {
    const entry = requested.get(it.variantid) || { name: it.product_name, quantity: 0 };
    entry.quantity += Number(it.quantity);
    requested.set(it.variantid, entry);
  }
  const lines = [];
  for (const [variantId, { name, quantity }] of requested) {
    const row = stockMap[variantId];
    const available = row?.stock ?? 0;
    if (quantity > available) {
      lines.push(`${name} (${row?.size || ""}/${row?.color || ""}): requested ${quantity}, available ${available}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

export function buildBillItemsPayload(billid, items, balanceDiscount = 0, overallDiscount = 0, docType = 'invoice') {
  const pricedItems = items.map(priceItem);
  const totalWithCharges = pricedItems.reduce((s, p) => s + p.withCharges, 0);

  let sumOverallDisc = 0;
  let sumBalanceDisc = 0;

  return items.map((it, idx) => {
    const priced = pricedItems[idx];
    const isLast = idx === items.length - 1;
    const proportion =
      totalWithCharges > 0
        ? priced.withCharges / totalWithCharges
        : 1 / Math.max(items.length, 1);

    let itemOverallDisc, itemBalanceDisc;
    if (isLast) {
      itemOverallDisc = overallDiscount > 0 ? round2(overallDiscount - sumOverallDisc) : 0;
      itemBalanceDisc = balanceDiscount > 0 ? round2(balanceDiscount - sumBalanceDisc) : 0;
    } else {
      itemOverallDisc = overallDiscount > 0 ? round2(overallDiscount * proportion) : 0;
      itemBalanceDisc = balanceDiscount > 0 ? round2(balanceDiscount * proportion) : 0;
      sumOverallDisc += itemOverallDisc;
      sumBalanceDisc += itemBalanceDisc;
    }
    const adjustedSubtotal = round2(
      priced.withCharges - itemOverallDisc - itemBalanceDisc,
    );

    // Split adjustedSubtotal into item and alteration pre-tax portions
    const alterProp =
      priced.withCharges > 0 ? priced.alteration / priced.withCharges : 0;
    const adjustedAlterPreTax = round2(adjustedSubtotal * alterProp);
    const adjustedItemPreTax = round2(adjustedSubtotal - adjustedAlterPreTax);

    // Re-evaluate GST slab: unstitched = always 5%; stitched = slab by post-discount price
    const qty = Number(it.quantity || 1);
    const stitchType = it.stitchType || "unstitched";
    let gstRate = Number(it.gstRate ?? 18);
    if (stitchType === "unstitched") {
      gstRate = 5;
    } else {
      const effectivePricePerUnit = qty > 0 ? adjustedItemPreTax / qty : 0;
      if (effectivePricePerUnit > 0) {
        gstRate = effectivePricePerUnit > 2500 ? 18 : 5;
      }
    }

    const itemGst = round2((adjustedItemPreTax * gstRate) / 100);
    const alterGst = round2(adjustedAlterPreTax * 0.05);
    const adjustedGst = round2(itemGst + alterGst);

    const alterFull = Number(it.alteration_charge || 0);
    const bosTotal = round2(adjustedItemPreTax + alterFull); // goods pre-tax (post all discounts) + full alteration, no GST

    return {
      billid,
      quantity: it.quantity,
      mrp: it.mrp,
      variantid: it.variantid || null,
      product_name: it.product_name || it.name || "",
      product_code: it.productid || it.product_code || null,
      category: it.category || null,
      cost_price: it.cost_price ?? null,
      alteration_charge: Number(it.alteration_charge || 0),
      discount_total: round2(
        priced.itemDisc + itemOverallDisc + itemBalanceDisc,
      ),
      subtotal: adjustedSubtotal,
      gst_rate: docType === 'bos' ? null : gstRate,
      gst_amount: docType === 'bos' ? 0 : adjustedGst,
      total: docType === 'bos' ? bosTotal : round2(adjustedSubtotal + adjustedGst),
      stitch_type: stitchType,
      unit_type: it.unit_type || "piece",
      salesperson_id: it.salesperson_id || null,
    };
  });
}

/**
 * An opened bill's lines as bill_save's draft ops and bill_edit take them: each saved line carries
 * its bill_item_id, so the database changes it in place; a new line has none and is inserted; a
 * saved line left out is deleted (_bill_lines_save, migration_bill_save_drafts.sql). Keeping the id
 * keeps exchange credit given from the line (exchanges.original_bill_item_id) pointing at it;
 * deleting and re-inserting every line used to drop that link, so a later edit or cancel could pay
 * the exchanged value back again.
 *
 * @param {Set<string>} savedIds - _id of each line as loaded from bill_items (String(bill_item_id))
 * @param {Array} items - form items, in the same order as payload
 * @param {Array} payload - buildBillItemsPayload(null, items, ...)
 * @returns {Array} payload rows, each with bill_item_id (a number, or null for a new line)
 */
export function linesWithSavedIds(savedIds, items, payload) {
  return payload.map((row, idx) => ({
    bill_item_id: savedIds.has(items[idx]._id) ? Number(items[idx]._id) : null,
    ...row,
  }));
}

/** Why an exchanged line's quantity cannot go up: the new units were never sold, yet could be
 * exchanged for credit again. Shared with ItemRow's note. */
export const EXCHANGED_QTY_UP = (name, savedQty) =>
  `${name}: already exchanged, so the quantity cannot go above ${savedQty}. Add more as a new item.`;

/**
 * Why the form's lines cannot be saved over lines exchange credit was given for, one line per
 * problem, or null. Such a line stays on the bill with at least the exchanged quantity and no more
 * than its saved quantity; the database refuses anything else (BILL_ITEM_EXCHANGED,
 * migration_bill_item_exchange_lock.sql).
 *
 * @param {Array} items - form items
 * @param {Object} exchangedById - { [_id]: { qty, savedQty, name } } for saved lines with exchanges
 */
export function exchangedLineProblems(items, exchangedById) {
  const byId = new Map(items.map((it) => [it._id, it]));
  const lines = [];
  for (const [id, { qty, savedQty, name }] of Object.entries(exchangedById || {})) {
    const it = byId.get(id);
    if (!it) lines.push(`${name}: ${qty} already exchanged, so it stays on the bill`);
    else if (Number(it.quantity) < qty) lines.push(`${name}: ${qty} already exchanged, so the quantity cannot go below ${qty}`);
    else if (savedQty != null && Number(it.quantity) > savedQty) lines.push(EXCHANGED_QTY_UP(name, savedQty));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Back-calculate the quickDiscountPct from stored discount_total.
 * Used when loading bill_items from DB to reconstruct the form state.
 *
 * @param {number} discount_total - The stored discount amount
 * @param {number} mrp - The item MRP
 * @param {number} quantity - The item quantity
 * @returns {number} The discount percentage (0-100), rounded to 2 decimal places
 */
export function backCalcDiscountPct(discount_total, mrp, quantity) {
  const base = mrp * quantity;
  if (base === 0) return 0;
  return Math.round(((discount_total / base) * 100 + Number.EPSILON) * 100) / 100;
}
