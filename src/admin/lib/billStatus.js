// src/admin/lib/billStatus.js
// A bill's lifecycle state is two columns, paymentstatus and finalized. The bills table
// refuses pairs that disagree and changes out of order (schema/migration_bill_status_states.sql):
//   draft (finalized false) -> partial or finalized (finalized true), which move between each other;
//   any of them -> cancelled, which keeps finalized and is final.
// Writers take both columns from billStatusFields, so they cannot be set apart.
// Shared by the admin screens and the CLI; imports carry .js for Node ESM.

export const BILL_STATUS = Object.freeze({
  DRAFT: "draft",
  PARTIAL: "partial",
  FINALIZED: "finalized",
  CANCELLED: "cancelled",
});

/**
 * The paymentstatus and finalized to write for a draft, part-paid or paid bill.
 * Cancelling is refused here: bill_cancel does it, keeping finalized as it was.
 */
export function billStatusFields(status) {
  switch (status) {
    case BILL_STATUS.DRAFT:
      return { paymentstatus: status, finalized: false };
    case BILL_STATUS.PARTIAL:
    case BILL_STATUS.FINALIZED:
      return { paymentstatus: status, finalized: true };
    default:
      throw new Error(`Bill status "${status}" cannot be written directly; cancel through bill_cancel`);
  }
}

export const isDraft = (bill) => bill.paymentstatus === BILL_STATUS.DRAFT;

export const isCancelled = (bill) => bill.paymentstatus === BILL_STATUS.CANCELLED;
