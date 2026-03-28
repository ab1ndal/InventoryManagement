# State

## Current Position

Phase: Not started (roadmap defined)
Plan: —
Status: Ready to plan Phase 1
Last activity: 2026-03-28 — Milestone v1.0 started, roadmap created

## Accumulated Context

- Bills table has `paymentstatus` column that can be used for 'voided' state (avoids schema migration)
- `bill_items` cascade-deletes when parent `bills` row is deleted
- Discount tracking goes in `discount_usage` table (billid + customerid + code)
- QZ Tray was attempted and abandoned — use browser `window.print()` for PDF/printing
- `computeBillTotals` in `billUtils.js` is the source of truth for all totals
- BillingForm already has `billId` prop but doesn't fetch existing data (Phase 2 work)

## Blockers

None.

## Pending Todos

- [ ] Plan Phase 1 (`/gsd:plan-phase 1`)
