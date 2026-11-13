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
 * Money the shop holds for a bill. bill_payments is the ledger of record, so sum it when rows
 * exist (refund and store credit rows are negative); bills paid in one go write no row and use
 * bills.payment_amount.
 * Null when neither records anything.
 */
export function receivedAmount(bill) {
  if (bill?.bill_payments?.length) return sumPayments(bill.bill_payments);
  return bill?.payment_amount != null ? Number(bill.payment_amount) : null;
}

// Bill totals carry paise from item-level rounding (e.g. ₹1500.08) while payments are taken in
// whole rupees, so a shortfall under one rupee counts as paid in full.
// bill_add_payment (schema/migration_bill_add_payment.sql) applies the same rule in the
// database when a payment is recorded; change both together.
const PAID_IN_FULL_TOLERANCE = 1;

function coversNet(totalPaid, net) {
  return net - totalPaid < PAID_IN_FULL_TOLERANCE;
}

/**
 * Where a bill stands after recording one more payment. The screen records payments through
 * bill_add_payment, which decides this in the database; this is the same rule, and the
 * "same rule as bill_add_payment" tests pin the cases both must agree on.
 *
 * @param {Array} existingPayments - bill_payments rows already recorded
 * @param {number} newAmount - the payment being added
 * @param {number} netAmount - amount payable after store/exchange credit
 * @returns {{ totalPaid: number, remaining: number, isFullyPaid: boolean, paymentStatus: string }}
 */
export function tallyPayment(existingPayments, newAmount, netAmount) {
  const totalPaid = round2(sumPayments(existingPayments) + Number(newAmount || 0));
  const net = round2(Number(netAmount || 0));
  const isFullyPaid = coversNet(totalPaid, net);
  return {
    totalPaid,
    remaining: isFullyPaid ? 0 : round2(net - totalPaid),
    isFullyPaid,
    paymentStatus: isFullyPaid ? "finalized" : "partial",
  };
}

/**
 * Payment status to save after editing a bill. A bill paid in installments (or finalized
 * with nothing paid) is judged by its bill_payments against the new total, so an edit can
 * move it between "partial" and "finalized". A bill paid in one go has no ledger and keeps
 * its status; a draft stays a draft.
 */
export function paymentStatusAfterEdit({ finalized, paymentStatus, payments, netAmount }) {
  if (!finalized) return "draft";
  if (paymentStatus !== "partial" && !payments?.length) return "finalized";
  return coversNet(sumPayments(payments), round2(Number(netAmount || 0))) ? "finalized" : "partial";
}

/**
 * Money an edit leaves the shop holding over: what it holds for the bill (its payment rows'
 * sum, which nets refunds and store credit, or payment_amount for a bill paid in one go) less
 * the new net. Only part-paid and paid bills hold money, and under a rupee is not counted.
 * Staff then choose a refund or store credit; bill_edit (schema/migration_bill_edit_excess.sql)
 * works it out the same way and refuses a choice for a different amount.
 */
export function editExcess({ paymentStatus, payments, paymentAmount, netAmount }) {
  if (paymentStatus !== "partial" && paymentStatus !== "finalized") return 0;
  const held = payments?.length ? sumPayments(payments) : round2(Number(paymentAmount || 0));
  const excess = round2(held - round2(Number(netAmount || 0)));
  return excess >= PAID_IN_FULL_TOLERANCE ? excess : 0;
}

/** What a bill_payments row was: a payment, money paid back, or money moved to store credit. */
export function paymentRowLabel(p) {
  const method = p?.salesmethods?.methodname || p?.methodname || "—";
  if (p?.kind === "refund") return `Refund (${method})`;
  if (p?.kind === "store_credit") return "To store credit";
  return method;
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
