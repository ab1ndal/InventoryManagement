// Pure helper functions for stock delta computation and bill item payload building

import { priceItem, round2 } from "./billUtils";

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
 * @param {number} billid - The bill ID to associate items with
 * @param {Array} items - BillingForm item objects
 * @returns {Array} Array of bill_items insert objects ready for Supabase insert
 */
export function buildBillItemsPayload(billid, items, balanceDiscount = 0, overallDiscount = 0) {
  const totalWithCharges = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  return items.map((it) => {
    const priced = priceItem(it);
    const proportion = totalWithCharges > 0 ? priced.withCharges / totalWithCharges : 1 / Math.max(items.length, 1);
    const itemOverallDisc = overallDiscount > 0 ? round2(overallDiscount * proportion) : 0;
    const itemBalanceDisc = balanceDiscount > 0 ? round2(balanceDiscount * proportion) : 0;
    const adjustedSubtotal = round2(priced.withCharges - itemOverallDisc - itemBalanceDisc);

    // Re-evaluate GST slab on effective per-piece price after all discounts
    const qty = Number(it.quantity || 1);
    const alteration = Number(it.alteration_charge || it.stitching_charge || 0);
    const cat = it.category || it.manual_category || null;
    let gstRate = Number(it.gstRate ?? 18);
    if (cat === 'SA' || cat === 'ST') {
      gstRate = 5;
    } else if (cat !== null) {
      const garmentTaxable = adjustedSubtotal - alteration;
      const effectivePricePerUnit = qty > 0 ? garmentTaxable / qty : 0;
      if (effectivePricePerUnit > 0) {
        gstRate = effectivePricePerUnit <= 2500 ? 5 : 18;
      }
    }

    const adjustedGst = round2((adjustedSubtotal * gstRate) / 100);
    return {
      billid,
      quantity: it.quantity,
      mrp: it.mrp,
      variantid: it.variantid || null,
      product_name: it.product_name || it.name || "",
      product_code: it.productid || it.product_code || null,
      category: it.category || null,
      alteration_charge: it.alteration_charge || 0,
      discount_total: round2(priced.itemDisc + itemOverallDisc + itemBalanceDisc),
      subtotal: adjustedSubtotal,
      gst_rate: gstRate,
      gst_amount: adjustedGst,
      total: round2(adjustedSubtotal + adjustedGst),
    };
  });
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
