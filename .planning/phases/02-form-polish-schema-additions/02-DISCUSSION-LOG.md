# Phase 2: Form Polish & Schema Additions - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-04
**Phase:** 02-form-polish-schema-additions
**Areas discussed:** Salesperson selector UX, Salesperson seed data, Manual item field layout, Bill load + salesperson restore, BillTable display improvements, Z Code / cost_price addition

---

## Salesperson Selector UX

| Option | Description | Selected |
|--------|-------------|----------|
| Combobox + checkboxes | Dropdown with search, checkboxes per name, chips for selected | ✓ |
| Inline checkboxes | All salespersons listed as checkboxes directly in form | |
| Plain multi-select | HTML select multiple | |

**User's choice:** Combobox + checkboxes
**Notes:** Selected names shown as dismissible chips above/near the dropdown.

---

## Salesperson Restore on Bill Load

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, restore on load | Fetch bill_salespersons on bill edit, pre-populate selector | ✓ |
| Always start empty | Re-select salespersons each time | |

**User's choice:** Yes, restore on load
**Notes:** User also specified salesperson schema during this discussion: `salesperson_id, name, date_hired, active`. Salespersons seeded directly via SQL INSERT; management UI deferred to future milestone. Only `active = true` salespersons shown.

---

## Salesperson Seed Data

**Decision made inline above:** User seeds directly via SQL INSERT. No UI needed in Phase 2. Future milestone will add a management tab.

---

## Manual Item Field Layout

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped sections | Item Details (name/code/category/size/color) + Pricing (qty/MRP/alteration/GST) | ✓ |
| Flat grid | All fields in single 2-column grid | |

**User's choice:** Grouped sections
**Notes:** User also requested Z Code (cost price) field — labeled "Z Code" in UI, stored as `cost_price` in bill_items. Not shown to customers.

---

## Z Code / Cost Price

| Option | Description | Selected |
|--------|-------------|----------|
| Cost price (purchase price) | Profit = MRP − cost_price | ✓ |
| Internal SKU / supplier code | Separate code from product_code | |

**User's choice:** Cost price — labeled "Z Code" in UI, stored as `cost_price numeric(10,2)` in bill_items.

| Option | Description | Selected |
|--------|-------------|----------|
| Store in database | Add cost_price column to bill_items | ✓ |
| Form-only display | Don't persist | |

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-fill from product | Pull purchaseprice from products for inventory items | ✓ |
| Always manual entry | Staff type for every item | |

**Notes:** Inventory items auto-fill from `products.purchaseprice`; manual items require staff entry.

---

## BillTable Display Improvements

| Option | Description | Selected |
|--------|-------------|----------|
| Customer name column | JOIN on customers to show name | ✓ |
| Round/format values | 2 decimal places display | ✓ |
| Edit icon | Replace button with icon | ✓ |
| Placeholder delete + PDF icons | Disabled icons for Phase 3/4 features | ✓ |

**User's choice:** All of the above
**Notes:** Delete and PDF icons are placeholder/disabled in Phase 2 — wired in Phases 3 and 4 respectively.

---

## Claude's Discretion

- Dropdown opacity root fix approach
- Combobox multi-select implementation details
- InventoryPicker query changes for purchaseprice
- Migration file naming/structure

## Deferred Ideas

- Cancelled stamp across PDF → Phase 4
- Editing finalized bill appends to old PDF → Phase 3/4
- PDF created only after finalizing → Already Phase 3 plan
- Salesperson management UI tab → Future milestone
