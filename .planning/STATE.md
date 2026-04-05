---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Completed 02-02-PLAN.md
last_updated: "2026-04-05T03:44:20.422Z"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 6
  completed_plans: 5
---

# State

## Current Position

Phase: 02 (form-polish-schema-additions) — EXECUTING
Plan: 2 of 3

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

**Schema additions needed (Phase 2):**

- `bills`: add `payment_method` text, `payment_amount` numeric
- New: `salespersons` (salesperson_id, name, active)
- New: `bill_salespersons` (billid FK, salesperson_id FK) junction table

**Key files:**

- `src/admin/components/billing/BillingForm.js` — main form, Save/Finalize TODOs
- `src/admin/components/billing/billUtils.js` — pricing logic, `computeBillTotals()`
- `src/admin/components/billing/stockHelpers.js` — pure helpers: computeStockDelta, buildBillItemsPayload, backCalcDiscountPct (Plan 01-01)
- `src/admin/components/BillTable.js` — bill list with pagination
- `src/admin/components/billing/ManualItemForm.js` — needs field parity with inventory items
- `schema/initial_schema.sql` — existing schema reference
- `schema/migration_01_applied_codes.sql` — ADD COLUMN applied_codes text[] on bills (needs manual execution in Supabase)

## Blockers

None.

## Pending Todos

- [ ] Run `schema/migration_01_applied_codes.sql` in Supabase dashboard (ADD COLUMN applied_codes text[] on bills)

## Session

Last session: 2026-04-05T03:44:20.417Z
Stopped at: Completed 02-02-PLAN.md
