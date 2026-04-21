// Pure helpers for exchange credit computation and remaining-returnable-qty logic.
// Consumed by ExchangePage (Plan 02) and unit tests.

import { round2 } from "./billUtils";

/**
 * Compute credit amount for a partial (or full) return of a single bill_item.
 * Per D-08: credit = (mrp * returnQty) - item_discount_proportional + alteration_charge_proportional.
 * GST is included — no separate GST computation.
 *
 * @param {Object} bi - bill_item row (must have: quantity, mrp, discount_total, alteration_charge)
 * @param {number} returnQty - quantity being returned (0 <= returnQty <= bi.quantity)
 * @returns {number} credit amount rounded to 2 decimals (0 if returnQty <= 0 or bi invalid)
 */
export function calcItemCredit(bi, returnQty) {
  // TODO: implement in Task 2
  return 0;
}

/**
 * Build a map from bill_item_id -> already-returned-quantity by summing existing exchanges rows.
 *
 * @param {Array<{original_bill_item_id:number, quantity:number}>} existingExchanges
 * @returns {Object<number, number>} map of bill_item_id -> total already returned
 */
export function buildReturnedQtyMap(existingExchanges) {
  // TODO: implement in Task 2
  return {};
}

/**
 * Compute remaining returnable qty per bill_item.
 *
 * @param {Array} billItems - rows from bill_items table
 * @param {Array<{original_bill_item_id:number, quantity:number}>} existingExchanges
 * @returns {Array} billItems with extra field `maxReturnQty = quantity - alreadyReturned`, filtered to maxReturnQty > 0
 */
export function computeMaxReturnQty(billItems, existingExchanges) {
  // TODO: implement in Task 2
  return [];
}

/**
 * Produce the array of returned items with per-item credit attached.
 * Filters out items where returnQtyMap[bill_item_id] <= 0.
 *
 * @param {Array} billItems - bill_items rows
 * @param {Object<number, number>} returnQtyMap - bill_item_id -> returnQty
 * @returns {Array} [{...bi, returnQty, creditAmount}, ...]
 */
export function buildReturnedItemsWithCredit(billItems, returnQtyMap) {
  // TODO: implement in Task 2
  return [];
}
