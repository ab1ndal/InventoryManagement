---
phase: 02-form-polish-schema-additions
plan: 03
status: complete
completed_at: "2026-04-08"
---

# Summary: 02-03 — Wire Salespersons + cost_price into BillingForm

## What was built

**Task 1: cost_price threading through InventoryPicker and stockHelpers**

- `InventoryPicker.js`: Added `costPriceOverride` state initialized from `initialVal?.cost_price`. Added Z Code input field below GST selector, auto-filled from `selected.purchaseprice` with placeholder showing the product's cost. Added `cost_price` to the `onPicked` payload — uses override value if set, otherwise auto-fills from `selected.purchaseprice`.
- `stockHelpers.js`: Already had `cost_price: it.cost_price || null` in `buildBillItemsPayload` (implemented in plan 02-01).

**Task 2: BillingForm wiring**

- `BillingForm.js` already had SalespersonSelector imported, rendered, state-managed, and persisted to `bill_salespersons` (on both new draft and update paths) — implemented during prior session.
- Added `cost_price: bi.cost_price || 0` to the `loadBill` item reconstruction so Z Code is restored when editing an existing bill.

## What was skipped

Nothing — all auto tasks complete.

## Human checkpoint (Task 3)

**Pending user verification.** User must:
1. Run migrations: `migration_02_payment_fields.sql`, `migration_02_salespersons.sql`, `migration_02_cost_price.sql`
2. Seed a test salesperson: `INSERT INTO salespersons (name, active) VALUES ('Test Person', true);`
3. Test the 10-step verification checklist in the plan

## Files modified

- `src/admin/components/billing/InventoryPicker.js` — costPriceOverride state, Z Code input, cost_price in onPicked
- `src/admin/components/billing/BillingForm.js` — cost_price in loadBill item reconstruction

## Build status

`npm run build` — passes cleanly.
