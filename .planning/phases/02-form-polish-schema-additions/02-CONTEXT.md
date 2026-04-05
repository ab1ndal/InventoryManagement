# Phase 2: Form Polish & Schema Additions - Context

**Gathered:** 2026-04-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix dropdown opacity, complete the manual item form with full field parity (+ Z Code / cost_price), add a salesperson multi-select to BillingForm (schema + UI + restore on edit), and polish BillTable display. Write SQL migration scripts for all schema additions.

This phase does NOT include: cancel flow (Phase 4), PDF generation (Phase 3), or finalized bill amendment flow (Phase 3/4).

</domain>

<decisions>
## Implementation Decisions

### Dropdown Opacity (UI-01)
- **D-01:** Fix SelectTrigger opacity issue — `bg-background` on SelectTrigger resolves to a CSS variable that may be semi-transparent in some contexts. Check `src/components/ui/select.tsx` SelectTrigger; also inspect InventoryPicker's Select usage in the billing form. Ensure all Select components in BillingForm render with a solid background.

### Manual Item Form (UI-02)
- **D-02:** Use **grouped sections** layout:
  - **Item Details section:** category, product name, code, size (free-text), color (free-text)
  - **Pricing section:** qty, MRP, alteration charge, GST rate
- **D-03:** Size and color are free-text inputs — no preset dropdown list.
- **D-04:** Add a **Z Code** field (labeled "Z Code" in the UI, stored as `cost_price numeric(10,2)` in `bill_items`). This is for internal profit calculation and is NOT shown to customers. Goes in the Pricing section or alongside MRP.
- **D-05:** For **inventory items** added via InventoryPicker, auto-fill `cost_price` from `products.purchaseprice`. Staff can override if needed.
- **D-06:** For **manual items**, staff enter Z Code manually.

### Salesperson Selector (UI-03)
- **D-07:** Use a **combobox + checkboxes** pattern — dropdown with search, each salesperson name has a checkbox. Selected names display as dismissible chips above/near the dropdown.
- **D-08:** Show only **active** salespersons (`active = true`) in the selector.
- **D-09:** When **editing an existing bill**, restore previously saved salespersons by fetching `bill_salespersons` on load and pre-populating the selector. Consistent with how customer and discount codes are restored.
- **D-10:** Salesperson data is seeded **directly via SQL INSERT** by the user — no UI to manage salespersons in Phase 2. A management tab is deferred to a future milestone.

### Schema Additions (SCHEMA-01, SCHEMA-02 + new)
- **D-11 (SCHEMA-01):** Add `payment_method text CHECK (payment_method IN ('cash','card','upi','mixed'))` and `payment_amount numeric(10,2)` to `bills`.
- **D-12 (SCHEMA-02):** Create `salespersons` table with columns: `salesperson_id serial PRIMARY KEY, name text NOT NULL, date_hired date, active boolean DEFAULT true`. Create `bill_salespersons` junction table: `billid integer REFERENCES bills(billid) ON DELETE CASCADE, salesperson_id integer REFERENCES salespersons(salesperson_id), PRIMARY KEY (billid, salesperson_id)`.
- **D-13 (SCHEMA-03 — new):** Add `cost_price numeric(10,2)` column to `bill_items` for Z Code / profit tracking. Provide as a separate migration script.

### BillTable Display Improvements
- **D-14:** Add **customer name** column to BillTable — requires JOIN or lookup on `customers` table by `customerid`.
- **D-15:** **Round monetary values** to 2 decimal places in BillTable display.
- **D-16:** Replace text Edit button with an **edit icon**.
- **D-17:** Add **placeholder delete and PDF icons** in the action column — grayed out/disabled in Phase 2. Delete functionality wires in Phase 4; PDF in Phase 3.

### Claude's Discretion
- Dropdown opacity root fix: determine whether `bg-background` → `bg-white` is the right fix or if a wrapper/override is needed.
- Combobox multi-select implementation: use shadcn/cmdk Command component or build lightweight; match existing import style.
- InventoryPicker query: ensure `purchaseprice` is included in the product select query so it can be passed down to bill items.
- Migration file naming: follow existing convention (`migration_02_*.sql`); one file per schema concern or combine — Claude's discretion.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Forms & Components
- `src/admin/components/billing/ManualItemForm.js` — Current form to extend with grouped layout + new fields
- `src/admin/components/billing/BillingForm.js` — Main billing form; salesperson selector goes here; cost_price must flow into bill item state
- `src/admin/components/billing/InventoryPicker.js` — Uses Shadcn Select (opacity issue here); must query + pass `purchaseprice` for cost_price auto-fill
- `src/admin/components/billing/billUtils.js` — `normalizeItem()` and `computeBillTotals()` — any new fields (cost_price) may need to be threaded through here
- `src/admin/components/BillTable.js` — BillTable to update: customer name JOIN, value formatting, icon actions

### UI Primitives
- `src/components/ui/select.tsx` — Shadcn Select; inspect SelectTrigger `bg-background` for opacity fix

### Schema
- `schema/initial_schema.sql` — Current `bills`, `bill_items`, `salespersons` (does not exist yet) table definitions
- `schema/migration_01_applied_codes.sql` — Example of migration file naming convention

### Planning
- `.planning/ROADMAP.md` — Phase 2 section: SQL for SCHEMA-01 and SCHEMA-02 (note: salespersons schema now adds `date_hired date`)
- `.planning/REQUIREMENTS.md` — UI-01, UI-02, UI-03, SCHEMA-01, SCHEMA-02 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/select.tsx` — Shadcn Select with `SelectContent`, `SelectTrigger`, `SelectItem` — reuse for GST rate dropdown in ManualItemForm
- `src/admin/components/billing/CustomerSelector.js` — Custom combobox pattern (search input + dropdown list) — reference for building salesperson combobox; note it uses `bg-white` explicitly on dropdown div
- Direct Supabase client — already imported everywhere in billing components

### Established Patterns
- Direct Supabase calls from component state/effects (no API layer)
- Chip/dismissible display: no existing chip component — implement inline or use a simple flex + badge pattern
- `refreshFlag` toggle: used to trigger BillTable re-fetch after mutation
- Toast pattern: `{ title, description, variant: "destructive" }` for errors

### Integration Points
- BillingForm bill item state shape must include `cost_price` — threads from InventoryPicker (auto) and ManualItemForm (manual) into `handleSaveDraft` / `handleUpdateDraft`
- `bill_salespersons` insert/delete must happen alongside bill save/update in BillingForm handlers
- BillingForm load effect (BILL-03, Phase 1) must also fetch `bill_salespersons` to restore salesperson state
- BillTable customer name: add `customerid` JOIN in existing Supabase select query for bills

</code_context>

<specifics>
## Specific Ideas

- "Z Code" is the staff-facing label for cost price — keep this label in the UI; store as `cost_price` in DB
- Salesperson table schema includes `date_hired date` (user addition vs ROADMAP's original schema — use this version)
- Placeholder delete/PDF icons: visually present but disabled until Phases 3/4 wire them up
- Cancelled stamp on PDF and finalized bill amendment flow are explicitly NOT Phase 2

</specifics>

<deferred>
## Deferred Ideas

### Phase 3
- PDF generation triggered on Finalize (PRINT-01–04 already scoped)
- **Finalized bill amendment:** Editing a finalized bill should create a new bill and append the new invoice to the original PDF. Capture in Phase 3 context.

### Phase 4
- **"Cancelled" stamp across PDF:** When a bill is cancelled, show a diagonal "Cancelled" watermark/stamp on the original PDF. Capture in Phase 4 context.
- Full delete icon functionality: cancel bill, restore stock, issue voucher (BILL-05, STOCK-03, VOUCH-01)

### Future Milestone
- Salesperson management UI: a tab to add/edit/deactivate salespersons (user confirmed deferred)
- Sales commission reports per salesperson

</deferred>

---

*Phase: 02-form-polish-schema-additions*
*Context gathered: 2026-04-04*
