---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 04 Complete — Milestone Execution Done
stopped_at: Phase 04 all plans executed; ROADMAP SC-3/SC-4 alignment pending developer decision
last_updated: "2026-04-11T23:45:00Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 11
  completed_plans: 11
  percent: 100
---

# State

## Current Position

Phase: 04 (cancel-voucher-pdf) — COMPLETE
All 4 phases and 11 plans executed. Milestone v1.0 execution done.

## Pending Developer Decision

The verification report (`04-VERIFICATION.md`) found that ROADMAP Phase 4 Success Criteria 3 and 4 describe vouchers-table inserts and a voucher-code PDF — but the CONTEXT-phase design decision D-14 explicitly chose `customers.store_credit` instead (no voucher row, return receipt PDF). All functional work matches D-14 and the user approved the UAT checkpoint.

**Decision required — choose one:**
1. **Accept D-14:** Update ROADMAP.md Phase 4 SC-3 and SC-4 to match the implemented design. Verification status becomes `passed`.
2. **Reinstate voucher insert:** Plan a follow-up task to insert into the `vouchers` table and add a VoucherView PDF.

## Accumulated Context

### Roadmap Evolution

- Phase 5 added: Support different discount types in billing: percentage discounts, flat amount discounts, and buy-X-get-Y type deals

**Bill lifecycle (IMPORTANT):**

- Draft → stock subtracted immediately (inventory reserved)
- Finalized → stock stays subtracted, payment info required, PDF saved to Supabase Storage
- Cancelled → stock restored; store credit added to customers.store_credit (D-14); return receipt PDF generated (A5)

**Key decisions:**

- QZ Tray abandoned → use `window.print()` with `@media print` CSS for invoices and vouchers
- Stock subtracted on Draft save (not on Finalize) — this is intentional inventory reservation
- Salesperson tracking added now (schema + UI) for future commission milestone
- D-14: Store credit issued as `customers.store_credit` increment (NOT a vouchers table row)
- Cancel: stock restored, discount_usage deleted, promo vouchers un-redeemed, store_credit_used refunded
- BillingForm: store credit auto-applies on customer select; promotional vouchers redeemable via code input
- CustomerTable: total_spend and last_purchased_at derived live from finalized non-cancelled bills
- bg-white replaces bg-background in SelectTrigger for solid dropdown trigger in billing contexts (02-01)
- Z Code UI label maps to cost_price numeric(10,2) in bill_items; shown as internal-only field in ManualItemForm (02-01)
- GST rate is now an editable Select dropdown (0/5/12/18/28%) in ManualItemForm, defaulting to 18% (02-01)

**Schema additions (all completed):**

- `bills`: `payment_method` text, `payment_amount` numeric, `store_credit_used` numeric(10,2) default 0
- `bill_items`: `cost_price` numeric(10,2)
- New: `salespersons` (salesperson_id, name, active)
- New: `bill_salespersons` (billid FK, salesperson_id FK) junction table
- New: `vouchers` (voucher_id, customerid, value, expiry_date, redeemed, redeemed_at, redeemed_billid, source)

**Key files:**

- `src/admin/components/billing/BillingForm.js` — main form, Save/Finalize, store credit + voucher logic
- `src/admin/components/billing/billUtils.js` — pricing logic, `computeBillTotals()`
- `src/admin/components/billing/stockHelpers.js` — pure helpers: computeStockDelta, buildBillItemsPayload, backCalcDiscountPct
- `src/admin/components/billing/Summary.js` — deduction rows (voucher, store credit, re-apply button)
- `src/admin/components/billing/InvoiceView.js` — A4 invoice layout for PDF
- `src/admin/components/billing/ReturnReceiptView.js` — A5 store credit receipt layout for PDF
- `src/admin/components/billing/generateInvoicePdf.js` — html2canvas + jsPDF, format param (default 'a4')
- `src/admin/components/BillTable.js` — bill list, cancel flow, all 5 cancel handlers, refundStoreCreditForBill
- `src/admin/components/CustomerTable.js` — customer list, live-derived spend, Store Credit column
- `schema/initial_schema.sql` — existing schema reference
- `schema/migration_01_applied_codes.sql` — ADD COLUMN applied_codes text[] on bills
- `schema/migration_02_payment_fields.sql` — ADD COLUMN payment_method, payment_amount to bills
- `schema/migration_02_salespersons.sql` — CREATE TABLE salespersons + bill_salespersons
- `schema/migration_02_cost_price.sql` — ADD COLUMN cost_price to bill_items
- `schema/migration_04_store_credit_used.sql` — ADD COLUMN store_credit_used numeric(10,2) to bills

## Blockers

None — all functional work complete. ROADMAP SC-3/SC-4 documentation alignment is a developer decision (see above).

## Pending Todos

- [ ] Run `schema/migration_01_applied_codes.sql` in Supabase dashboard (ADD COLUMN applied_codes text[] on bills)
- [ ] Run `schema/migration_02_payment_fields.sql` in Supabase dashboard
- [ ] Run `schema/migration_02_salespersons.sql` in Supabase dashboard
- [ ] Run `schema/migration_02_cost_price.sql` in Supabase dashboard
- [ ] Run `schema/migration_04_store_credit_used.sql` in Supabase dashboard (ADD COLUMN store_credit_used)
- [ ] Decide on ROADMAP SC-3/SC-4: accept D-14 (update ROADMAP) or reinstate voucher-table inserts

## Session

Last session: 2026-04-11T23:45:00Z
Stopped at: Phase 04 re-verification complete — all 3 plans verified
