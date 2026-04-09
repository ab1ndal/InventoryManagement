---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Awaiting human verification
stopped_at: Phase 3 UI-SPEC approved
last_updated: "2026-04-09T15:53:40.508Z"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 6
  completed_plans: 6
---

# State

## Current Position

Phase: 02 (form-polish-schema-additions) — AWAITING HUMAN VERIFICATION
Plan: 3 of 3 (all code complete)

## Accumulated Context

**Bill lifecycle (IMPORTANT):**

- Draft → stock subtracted immediately (inventory reserved)
- Finalized → stock stays subtracted, payment info required, PDF saved to Supabase Storage
- Cancelled → stock restored, voucher PDF issued to customer (if customer on bill)

**Key decisions:**

- QZ Tray abandoned → use `window.print()` with `@media print` CSS for invoices and vouchers
- Stock subtracted on Draft save (not on Finalize) — this is intentional inventory reservation
- Salesperson tracking added now (schema + UI) for future commission milestone
- Customer total_spend + last_purchased_at updated on Finalize
- Cancelling a finalized bill should reverse discount_usage and optionally reverse customer total_spend
- bg-white replaces bg-background in SelectTrigger for solid dropdown trigger in billing contexts (02-01)
- Z Code UI label maps to cost_price numeric(10,2) in bill_items; shown as internal-only field in ManualItemForm (02-01)
- GST rate is now an editable Select dropdown (0/5/12/18/28%) in ManualItemForm, defaulting to 18% (02-01)

**Schema additions needed (Phase 2):**

- `bills`: add `payment_method` text, `payment_amount` numeric
- New: `salespersons` (salesperson_id, name, active)
- New: `bill_salespersons` (billid FK, salesperson_id FK) junction table

**Key files:**

- `src/admin/components/billing/BillingForm.js` — main form, Save/Finalize TODOs
- `src/admin/components/billing/billUtils.js` — pricing logic, `computeBillTotals()`
- `src/admin/components/billing/stockHelpers.js` — pure helpers: computeStockDelta, buildBillItemsPayload, backCalcDiscountPct (Plan 01-01)
- `src/admin/components/BillTable.js` — bill list with pagination
- `src/admin/components/billing/ManualItemForm.js` — rewritten with 10 fields, two grouped sections, Z Code + GST selector (02-01)
- `schema/initial_schema.sql` — existing schema reference
- `schema/migration_01_applied_codes.sql` — ADD COLUMN applied_codes text[] on bills (needs manual execution in Supabase)
- `schema/migration_02_payment_fields.sql` — ADD COLUMN payment_method, payment_amount to bills (needs manual execution)
- `schema/migration_02_salespersons.sql` — CREATE TABLE salespersons + bill_salespersons (needs manual execution)
- `schema/migration_02_cost_price.sql` — ADD COLUMN cost_price to bill_items (needs manual execution)

## Blockers

None.

## Pending Todos

- [ ] Run `schema/migration_01_applied_codes.sql` in Supabase dashboard (ADD COLUMN applied_codes text[] on bills)
- [ ] Run `schema/migration_02_payment_fields.sql` in Supabase dashboard
- [ ] Run `schema/migration_02_salespersons.sql` in Supabase dashboard
- [ ] Run `schema/migration_02_cost_price.sql` in Supabase dashboard

## Session

Last session: 2026-04-09T15:53:40.504Z
Stopped at: Phase 3 UI-SPEC approved
