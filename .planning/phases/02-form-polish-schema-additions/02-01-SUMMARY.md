---
phase: 02-form-polish-schema-additions
plan: 01
subsystem: database, ui
tags: [supabase, postgresql, react, shadcn, tailwind, billing, schema-migration]

# Dependency graph
requires:
  - phase: 01-billing-db-persistence
    provides: bills/bill_items schema foundation and billing form components

provides:
  - SQL migration scripts for payment_method/payment_amount on bills table
  - SQL migration scripts for salespersons and bill_salespersons tables
  - SQL migration script for cost_price on bill_items table
  - Fixed SelectTrigger with solid white background globally
  - Rewritten ManualItemForm with 10 fields in two grouped sections including Z Code and GST rate

affects: [02-02, 02-03, billing-form, bill-save-finalize]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL migrations: one file per schema concern, named migration_NN_description.sql"
    - "SelectTrigger uses bg-white for solid background in all billing contexts"
    - "ManualItemForm grouped layout: Item Details section + Pricing section"

key-files:
  created:
    - schema/migration_02_payment_fields.sql
    - schema/migration_02_salespersons.sql
    - schema/migration_02_cost_price.sql
  modified:
    - src/components/ui/select.tsx
    - src/admin/components/billing/ManualItemForm.js

key-decisions:
  - "bg-background replaced with bg-white in SelectTrigger — global fix ensures solid dropdown trigger in all billing contexts"
  - "Z Code (cost_price) stored as cost_price numeric(10,2) in bill_items; labeled 'Z Code' in UI with helper text 'Internal only — not shown to customer'"
  - "GST rate is now an editable Select dropdown (0/5/12/18/28%) in ManualItemForm, defaulting to 18%"
  - "Size and color are free-text inputs (no preset dropdown) per D-03"

patterns-established:
  - "ManualItemForm grouped sections: 'Item Details' (category, name, code, size, color) and 'Pricing' (qty, MRP, alteration charge, GST rate, Z Code)"
  - "onAdd payload shape extended with size, color, gstRate (editable), alteration_charge (editable), cost_price"

requirements-completed: [SCHEMA-01, SCHEMA-02, UI-01, UI-02]

# Metrics
duration: 12min
completed: 2026-04-05
---

# Phase 02 Plan 01: Schema Migrations + SelectTrigger Fix + ManualItemForm Rewrite Summary

**Three SQL migration scripts for payment, salespersons, and cost_price schema additions; SelectTrigger bg-white fix; ManualItemForm rewritten with 10 fields across Item Details and Pricing sections including Z Code and GST rate selector**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-05T03:41:17Z
- **Completed:** 2026-04-05T03:53:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created 3 SQL migration scripts covering all Phase 2 schema additions (payment fields, salespersons junction table, cost_price column)
- Fixed SelectTrigger opacity by replacing `bg-background` with `bg-white` globally in select.tsx
- Rewrote ManualItemForm from 5 fields to 10 fields in two grouped sections with GST dropdown, Z Code field, validation, and updated button copy

## Task Commits

Each task was committed atomically:

1. **Task 1: SQL migration scripts for payment fields, salespersons, and cost_price** - `dafa8c3` (chore)
2. **Task 2: Fix SelectTrigger opacity and rewrite ManualItemForm** - `a978387` (feat)

**Plan metadata:** _(final docs commit — see below)_

## Files Created/Modified

- `schema/migration_02_payment_fields.sql` - ALTER TABLE bills ADD COLUMN payment_method (CHECK constraint) and payment_amount
- `schema/migration_02_salespersons.sql` - CREATE TABLE salespersons and bill_salespersons junction table
- `schema/migration_02_cost_price.sql` - ALTER TABLE bill_items ADD COLUMN cost_price numeric(10,2)
- `src/components/ui/select.tsx` - SelectTrigger className changed from bg-background to bg-white
- `src/admin/components/billing/ManualItemForm.js` - Full rewrite with 10 fields, grouped layout, GST Select dropdown, Z Code with helper text, button validation

## Decisions Made

- `bg-white` is the correct fix over `bg-background` — the CSS variable resolves to a semi-transparent value in the billing form's dark layered context. SelectContent already used `bg-white`, making this consistent.
- Z Code (cost_price) includes "Internal only — not shown to customer" helper text so staff understand the field scope.
- Color field is `col-span-2` since it tends to need more space for descriptions like "Navy Blue"; size is single-column.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

**SQL migrations must be executed manually in Supabase SQL Editor.** Three migration scripts are ready to run:

1. `schema/migration_02_payment_fields.sql` — adds payment_method and payment_amount to bills
2. `schema/migration_02_salespersons.sql` — creates salespersons and bill_salespersons tables
3. `schema/migration_02_cost_price.sql` — adds cost_price to bill_items

Run each script in order via the Supabase dashboard SQL Editor.

## Known Stubs

None — ManualItemForm is fully wired. The cost_price field is editable by staff and passed in the onAdd payload. Plans 02-02 and 02-03 will wire salesperson selector and BillingForm persistence for cost_price.

## Next Phase Readiness

- 02-02 (Salesperson selector + BillTable polish) can now create the salesperson combobox against the migration schema
- 02-03 (BillingForm wiring) can use cost_price from ManualItemForm onAdd payload
- SelectTrigger fix is global — InventoryPicker's Select dropdowns also benefit

---
*Phase: 02-form-polish-schema-additions*
*Completed: 2026-04-05*

## Self-Check: PASSED

- All 6 files exist (3 migration SQL, select.tsx, ManualItemForm.js, SUMMARY.md)
- Commits dafa8c3 and a978387 confirmed in git log
- Build passes with no errors
