# Phase 6: Exchange and Returns — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 06 — Exchange and Returns
**Areas discussed:** Exchange entry point, Return scope & item selection, New bill generation flow, Store credit PDF design

---

## Exchange Entry Point

| Option | Description | Selected |
|--------|-------------|----------|
| ExchangePage with bill search | Dedicated hub — search bill by number or customer name | ✓ |
| BillTable action button | Add Exchange button per bill row in BillTable | |
| Both | ExchangePage primary + BillTable quick-link | |

**User's choice:** ExchangePage with bill search
**Notes:** Finalized bills only (draft/cancelled excluded from search)

---

## Return Scope & Item Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Any subset of items, partial quantities | Return 1 of 3 of same item, pick specific items | ✓ |
| Whole items only, no partial quantity | Return full line items only | |
| Full bill return only | Return all items at once | |

**User's choice:** Any subset of items, partial quantities

**Manual items (follow-up):**
- Manual items ARE returnable
- New `stock` column on `manual_items` table (`integer not null default 1`, adjustable)
- On return: `manual_items.stock += returned_qty`

---

## New Bill Generation Flow

| Option | Description | Selected |
|--------|-------------|----------|
| Open BillingForm pre-populated | Exchange credit as Additional Discount | ✓ (custom) |
| Just issue store credit | Staff creates new bill manually | |
| New bill is optional | Prompt at end of exchange | |

**User's choice (custom):** Open BillingForm with "Additional Discount" = credit_amount (sum of MRP - item discount + GST per returned item), labeled with original bill number (e.g. "Return Credit — Bill #BC25001")

**If new bill abandoned:**
- Store credit already added to `customers.store_credit` before bill opens
- Exchange is complete; credit persists for future use
- Issue return confirmation PDF mentioning store credit

---

## Store Credit PDF Design

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse ReturnReceiptView | Extend existing A5 component (cancellation + exchange modes) | ✓ |
| New ExchangeReceiptView | Separate component for exchange receipts | |
| You decide | Claude picks | |

**User's choice:** Reuse ReturnReceiptView

**Receipt content:** Store header + original bill number + returned items list + credit amount + note that store credit added to account

---

## Claude's Discretion

- Bill search UI style on ExchangePage
- Confirmation dialog copy
- No-customer edge case handling (exchange proceeds, store credit skipped)
- Error handling for partial restock failures

## Deferred Ideas

- BillTable quick-link shortcut to ExchangePage
- Saving return receipt to Supabase Storage
- Exchange history view per customer
- Reason code dropdown (currently free text)
