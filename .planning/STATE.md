# State

## Current Position

Phase: Not started (roadmap defined)
Plan: —
Status: Ready to plan Phase 1
Last activity: 2026-03-28 — Milestone v1.0 started, requirements & roadmap updated

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
- `src/admin/components/BillTable.js` — bill list with pagination
- `src/admin/components/billing/ManualItemForm.js` — needs field parity with inventory items
- `schema/initial_schema.sql` — existing schema reference

## Blockers

None.

## Pending Todos

- [ ] Plan Phase 1 (`/gsd:plan-phase 1`)
