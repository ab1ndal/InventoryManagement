---
phase: 06-exchange-and-returns-bill-lookup-partial-item-credit-store-c
plan: "01"
subsystem: exchange-helpers
tags: [exchange, returns, schema, unit-tests, pure-functions]
dependency_graph:
  requires: []
  provides:
    - exchangeHelpers.calcItemCredit
    - exchangeHelpers.buildReturnedQtyMap
    - exchangeHelpers.computeMaxReturnQty
    - exchangeHelpers.buildReturnedItemsWithCredit
    - schema/migration_14_manual_items_stock.sql
  affects:
    - src/admin/pages/ExchangePage.js (Plan 02 consumer)
    - src/admin/components/billing/BillingForm.js (Plan 03 consumer)
tech_stack:
  added: []
  patterns:
    - Pure helper module pattern (no I/O, all math)
    - TDD RED→GREEN cycle for billing math
key_files:
  created:
    - schema/migration_14_manual_items_stock.sql
    - src/admin/components/billing/exchangeHelpers.js
    - src/admin/components/billing/__tests__/exchangeHelpers.test.js
  modified: []
decisions:
  - "D-08 credit formula: (mrp * returnQty) - discount_proportional + alteration_proportional; GST included"
  - "D-19: manual_items.stock column added via migration_14, default 1"
  - "buildReturnedQtyMap uses numeric bill_item_id keys (object, not Map) for simplicity"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-21T16:37:16Z"
  tasks_completed: 2
  tasks_total: 3
  files_created: 3
  files_modified: 0
---

# Phase 06 Plan 01: Exchange Helpers Foundation Summary

**One-liner:** Pure exchange-credit math helpers (D-08 formula + qty-map) with 13 passing unit tests, plus migration SQL adding `manual_items.stock`.

## What Was Built

### Migration SQL
`schema/migration_14_manual_items_stock.sql` — idempotent `ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 1` on `public.manual_items`. Satisfies D-19: manual items are now restock-able when returned in exchange flow.

### exchangeHelpers.js
Four exported pure functions in `src/admin/components/billing/exchangeHelpers.js`:

| Function | Purpose |
|----------|---------|
| `calcItemCredit(bi, returnQty)` | D-08 credit formula per returned item |
| `buildReturnedQtyMap(existingExchanges)` | Sum already-returned qty per bill_item_id |
| `computeMaxReturnQty(billItems, existingExchanges)` | Remaining returnable qty, drops fully-returned items |
| `buildReturnedItemsWithCredit(billItems, returnQtyMap)` | Attach returnQty + creditAmount to returned items |

All functions use `round2` from `./billUtils` and coerce inputs via `Number(x || 0)` (T-06-03 mitigated).

### Unit Tests
`src/admin/components/billing/__tests__/exchangeHelpers.test.js` — 4 describe blocks, 13 tests total. All pass (GREEN).

Coverage: full-qty return, partial-qty proportional, zero-qty guard, negative-qty guard, null/undefined fields, zero-mrp edge case, multi-item qty accumulation, null/empty input, fully-returned item filtering, credit attachment.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 (RED) | ec0105f | test(06-01): add failing exchangeHelpers tests + migration 14 SQL |
| 2 (GREEN) | 472ee09 | feat(06-01): implement exchangeHelpers — credit formula + qty map |

## Pending: Task 3 (Blocking Checkpoint)

Migration `migration_14_manual_items_stock.sql` must be applied manually in Supabase dashboard. See checkpoint message below. Plan is paused until user confirms migration is live.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all four functions fully implemented and tested.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes beyond the planned `manual_items.stock` column. Migration is admin-only, applied manually via Supabase dashboard. `exchangeHelpers.js` is pure JS with no I/O. No new threat surface beyond T-06-01 through T-06-04 already in plan's threat model.

## Self-Check: PASSED

- `schema/migration_14_manual_items_stock.sql` — exists
- `src/admin/components/billing/exchangeHelpers.js` — exists, 0 TODO, 0 console.log
- `src/admin/components/billing/__tests__/exchangeHelpers.test.js` — exists, 13 tests pass
- Commits ec0105f and 472ee09 — present in git log
