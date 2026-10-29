// Payment-tally helpers.
//
// bills.payment_amount holds the TOTAL received for the bill and is kept in step with
// bill_payments on every payment. bill_payments remains the ledger of record (it carries
// the method and timestamp of each installment); payment_amount is the running total
// derived from it, so readers can get "amount received" without a second query.

import { round2 } from "./billUtils";

/** Total received across a bill's payment rows. */
export function sumPayments(payments) {
  return round2(
    (payments || []).reduce((s, p) => s + Number(p?.amount || 0), 0),
  );
}

/**
 * Where a bill stands after recording one more payment.
 *
 * @param {Array} existingPayments - bill_payments rows already recorded
 * @param {number} newAmount - the payment being added
 * @param {number} netAmount - amount payable after store/exchange credit
 * @returns {{ totalPaid: number, remaining: number, isFullyPaid: boolean, paymentStatus: string }}
 */
export function tallyPayment(existingPayments, newAmount, netAmount) {
  const totalPaid = round2(sumPayments(existingPayments) + Number(newAmount || 0));
  const net = round2(Number(netAmount || 0));
  const isFullyPaid = totalPaid >= net;
  return {
    totalPaid,
    remaining: round2(Math.max(0, net - totalPaid)),
    isFullyPaid,
    paymentStatus: isFullyPaid ? "finalized" : "partial",
  };
}

/**
 * Store-credit change that deducts `deduction` from `balance` without taking it
 * below zero (a negative `deduction` adds credit back). Billing has always floored
 * the balance at 0 when it moved since the form loaded it; the atomic
 * store_credit_adjust RPC takes a delta, so the floor is applied here.
 */
export function storeCreditDeductionDelta(balance, deduction) {
  const bal = Number(balance || 0);
  return round2(Math.max(0, bal - Number(deduction || 0)) - bal);
}

/**
 * The 'Website' sales method marks bills made by online orders. They are created
 * and changed only through Online Orders (refunds, returns, Bill of Supply), so the
 * in-store picker hides the method and the bill list locks those bills.
 */
export function isWebsiteMethod(method) {
  return (method?.methodname ?? "").trim().toLowerCase() === "website";
}
