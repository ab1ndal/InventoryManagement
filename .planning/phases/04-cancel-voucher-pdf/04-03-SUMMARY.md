---
plan: 04-03
phase: 04-cancel-voucher-pdf
status: complete
type: gap_closure
gaps_closed: [1, 2, 3, 4, 5, 6]
---

# Plan 04-03 Summary: Gap Closure

## What Was Built

All 6 UAT gaps from `04-UAT.md` resolved across 6 tasks.

## Gap → Task → Resolution

| Gap | Severity | Task | Resolution |
|-----|----------|------|------------|
| 1 — Return payment reverses gross instead of net | major | 3 | Removed `total_spend` mutation from `handleResolveReturnPayment`; CustomerTable now derives spend live from non-cancelled bills, so the correct net amount drops out automatically on cancel |
| 2 — Store credit not refunded on cancel | major | 1, 2, 3 | Added `bills.store_credit_used` column (migration); BillingForm writes it on Finalize; `refundStoreCreditForBill` helper reads it and adds back to `customers.store_credit` on all 5 cancel paths |
| 3 — CustomerTable missing Store Credit column; total_spend/last_purchased_at should be derived | major | 4 | `fetchCustomers` now aggregates `total_spend` and `last_purchased_at` live from finalized non-cancelled bills; Store Credit column added between Loyalty and Total Spend |
| 4 — Store credit receipt PDF is full A4, should be A5 | minor | 5 | `generateInvoicePdf` accepts optional `format` param (default `'a4'`); `ReturnReceiptView` widened to 559px; BillTable store-credit path calls with `'a5'` |
| 5 — No way to re-apply store credit after removing it | minor | 6, 2 | Summary accepts `customerStoreCreditBalance` and `onApplyStoreCredit` props; shows "Apply store credit (₹X)" button when `storeCreditApplied === 0` and balance > 0; BillingForm wires both props |
| 6 — Step 2 resolution dialog clips content | cosmetic | 3 | Dialog 2 `DialogContent` gets `max-h-[90vh] overflow-y-auto` |

## Files Modified

- `schema/migration_04_store_credit_used.sql` — new migration; run in Supabase SQL Editor
- `src/admin/components/billing/BillingForm.js` — persist `store_credit_used` on finalize; remove `total_spend` mutation; wire Summary re-apply props
- `src/admin/components/BillTable.js` — `refundStoreCreditForBill` helper + 5 call sites; remove all `total_spend` mutations; Dialog 2 sizing; A5 PDF call
- `src/admin/components/CustomerTable.js` — live-derived `total_spend`/`last_purchased_at`; Store Credit column
- `src/admin/components/billing/generateInvoicePdf.js` — optional `format` param
- `src/admin/components/billing/ReturnReceiptView.js` — 559px container width
- `src/admin/components/billing/Summary.js` — new props; re-apply store credit button

## Commits

- `ae8f527` feat(04-03): add migration for bills.store_credit_used column
- `daf2e11` fix(04-03): BillingForm - persist store_credit_used, remove total_spend mutation, wire Summary re-apply
- `fe97070` fix(04-03): BillTable - fix cancel paths, refund store credit, remove spend mutations, fix dialog sizing
- `93aae46` fix(04-03): CustomerTable - live-derive total_spend/last_purchased_at, add Store Credit column
- `3f53816` fix(04-03): half-A4 store credit receipt PDF (A5 format, 559px width)
- `6884c30` fix(04-03): Summary - add re-apply store credit button (gap 5)

## Verification

User approved Task 7 human checkpoint — all 6 gaps verified in-browser.
