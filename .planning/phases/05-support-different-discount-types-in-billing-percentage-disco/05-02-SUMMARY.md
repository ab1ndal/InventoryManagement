---
phase: 05-support-different-discount-types-in-billing-percentage-disco
plan: "02"
subsystem: billing
tags: [discounts, buy_x_get_y, invoice, free-items, form-validation]
dependency_graph:
  requires: ["05-01"]
  provides: [getFreeItems-helper, invoice-free-labels, discount-form-label-fix, zod-schema-db-aligned]
  affects: [DiscountForm, billUtils, InvoiceView, BillingForm]
tech_stack:
  added: []
  patterns: [extract-shared-helper, forwardRef-prop-addition, inline-style-badge]
key_files:
  modified:
    - src/admin/components/DiscountForm.js
    - src/admin/components/billing/billUtils.js
    - src/admin/components/billing/InvoiceView.js
    - src/admin/components/billing/BillingForm.js
decisions:
  - "getFreeItems() placed above valueOfDiscount in billUtils so valueOfDiscount can call it without hoisting"
  - "freeItemIndices labels a row FREE when ANY unit from that row is free — partial free rows still show badge since total discount amount is always correct"
  - "FREE label only in InvoiceView (printed PDF), not in Summary.js — per D-11"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 05 Plan 02: DiscountForm Labels, getFreeItems Helper, InvoiceView FREE Badge — Summary

**One-liner:** Removed stale 'custom' Zod enum value, fixed conditional-type label to 'Discount Amount (₹ off)', extracted reusable getFreeItems() from billUtils, and added green FREE badge to invoice line items for buy_x_get_y discounts.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix DiscountForm labels and remove custom type from Zod schema | 7dd8c17 | DiscountForm.js |
| 2 | Extract getFreeItems() helper and add FREE labels to InvoiceView | e10f6a1 | billUtils.js, InvoiceView.js, BillingForm.js |

## What Was Built

### Task 1: DiscountForm Labels + Zod Schema Fix

- Removed `"custom"` from the Zod enum in `discountSchema` — schema now matches the DB CHECK constraint exactly (5 types: flat, percentage, buy_x_get_y, fixed_price, conditional)
- Added conditional branch for the value field label: when `type === "conditional"` the label now reads `"Discount Amount (₹ off)"` instead of the ambiguous generic `"Value (₹)"` — makes it unambiguous this is a flat rupee deduction, not a threshold
- The buy_x_get_y category hint ("Category filter is applied from the Category field above") was already present — no change needed

### Task 2: getFreeItems() Extraction + InvoiceView FREE Labels

**billUtils.js:**
- Added exported `getFreeItems(d, items)` above `valueOfDiscount` — returns `Array<{ itemIndex, unitPrice }>` for the cheapest eligible units that are free under a buy_x_get_y discount
- Refactored the `case "buy_x_get_y"` block in `valueOfDiscount` to call `getFreeItems` instead of duplicating the cheapest-item sort logic

**InvoiceView.js:**
- Added `import { getFreeItems } from './billUtils'`
- Added `allDiscounts` to props destructuring
- After the `lineItems` map, computes `freeItemIndices` — a `Set<number>` of item indices that have at least one free unit via any applied buy_x_get_y code
- In the line item row's Particulars cell, renders a green-bordered `FREE` badge (inline style, 9px bold, `#16a34a`) when `freeItemIndices.has(idx)`

**BillingForm.js:**
- Added `allDiscounts={allDiscounts}` prop to the off-screen `<InvoiceView>` used for PDF capture

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — T-05-04 mitigated (custom removed from Zod enum). T-05-05 accepted (FREE label accuracy derived from same getFreeItems() as discount amount).

## Self-Check: PASSED

- File exists: `src/admin/components/DiscountForm.js` — modified
- File exists: `src/admin/components/billing/billUtils.js` — modified
- File exists: `src/admin/components/billing/InvoiceView.js` — modified
- File exists: `src/admin/components/billing/BillingForm.js` — modified
- Commit 7dd8c17 exists: confirmed (feat(05-02): fix DiscountForm labels and remove custom type from Zod schema)
- Commit e10f6a1 exists: confirmed (feat(05-02): extract getFreeItems helper and add FREE labels to InvoiceView)
- `export function getFreeItems` in billUtils.js: confirmed (line 97)
- `getFreeItems` imported in InvoiceView.js: confirmed (line 3)
- `FREE` text in InvoiceView.js: confirmed (line 141)
- `allDiscounts` prop in InvoiceView.js: confirmed (lines 18, 41, 43)
- `allDiscounts={allDiscounts}` in BillingForm.js InvoiceView render: confirmed
- `npm run build` passes: confirmed
