// Pure helpers for exchange credit computation and returnable-qty logic.
// Consumed by ExchangePage, BillingForm, Summary, and unit tests.

import { round2 } from "./billUtils";

export const EXCHANGE_WINDOW_DAYS = 7;

/** Calendar days since bill's orderdate (0 = same day, 7 = exactly 7 days later). */
export function daysSinceBill(orderdate) {
  const bd = new Date(orderdate);
  const today = new Date();
  const a = new Date(bd.getFullYear(), bd.getMonth(), bd.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((b - a) / 86_400_000);
}

export function isWithinExchangeWindow(orderdate) {
  return daysSinceBill(orderdate) <= EXCHANGE_WINDOW_DAYS;
}

/** Items with alteration_charge > 0 are ineligible — service already rendered. */
export function isExchangeEligible(bi) {
  return Number(bi?.alteration_charge || 0) === 0;
}

/**
 * Single source of truth for splitting grandTotal into store credit, exchange credit,
 * and remaining payable. Used in Summary, BillingForm balance-adjusted memo, and finalize.
 */
export function computeCreditsApplied(grandTotal, storeCreditAvail, exchangeAmt) {
  const storeCreditUsed = Math.min(Number(storeCreditAvail || 0), grandTotal);
  const afterStore = Math.max(0, grandTotal - storeCreditUsed);
  const exchangeCreditUsed = Math.min(Number(exchangeAmt || 0), afterStore);
  const effectiveTotal = Math.max(0, afterStore - exchangeCreditUsed);
  return { storeCreditUsed, exchangeCreditUsed, effectiveTotal };
}

/**
 * Credit = effective payment made = bi.total × (returnQty / quantity).
 * bi.total is the post-GST, post-discount line total stored in bill_items
 * (matches priceItem().total = (mrp×qty − discount) + gst_amount).
 */
export function calcItemCredit(bi, returnQty) {
  if (!bi || returnQty <= 0) return 0;
  const fullQty = Number(bi.quantity || 1);
  return round2(Number(bi.total || 0) * (returnQty / fullQty));
}

/** Sum already-returned qty per bill_item_id from existing exchanges rows. */
export function buildReturnedQtyMap(existingExchanges) {
  const map = {};
  for (const ex of (existingExchanges || [])) {
    const id = ex.original_bill_item_id;
    map[id] = (map[id] || 0) + Number(ex.quantity || 0);
  }
  return map;
}

/**
 * Unused exchange credit after applying to a bill.
 * > 0 only when exchangeAmt exceeds (grandTotal - storeCreditUsed).
 */
export function computeExchangeBalance(grandTotal, storeCreditAvail, exchangeAmt) {
  const { exchangeCreditUsed } = computeCreditsApplied(grandTotal, storeCreditAvail, exchangeAmt);
  return Math.max(0, round2(Number(exchangeAmt || 0) - exchangeCreditUsed));
}

/** Filter items to those with returnQtyMap > 0; attach returnQty and creditAmount. */
export function buildReturnedItemsWithCredit(billItems, returnQtyMap) {
  return (billItems || [])
    .filter(bi => (returnQtyMap[bi.bill_item_id] || 0) > 0)
    .map(bi => {
      const returnQty = returnQtyMap[bi.bill_item_id];
      return { ...bi, returnQty, creditAmount: calcItemCredit(bi, returnQty) };
    });
}
