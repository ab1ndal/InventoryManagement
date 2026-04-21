---
phase: 06-exchange-and-returns-bill-lookup-partial-item-credit-store-c
plan: "02"
subsystem: exchange-ui
tags: [exchange, returns, ui, pdf, store-credit, restock, routing]
dependency_graph:
  requires:
    - exchangeHelpers.calcItemCredit (plan 01)
    - exchangeHelpers.computeMaxReturnQty (plan 01)
    - exchangeHelpers.buildReturnedItemsWithCredit (plan 01)
    - schema/migration_14_manual_items_stock.sql (plan 01)
  provides:
    - ExchangePage: full search -> load -> item selection -> confirm flow
    - ReturnReceiptView: mode prop (cancel | exchange)
    - route state contract: { openNewBill, exchangeCredit, prefilledCustomerId }
  affects:
    - src/admin/pages/BillingPage.js (Plan 03 consumer — reads route state)
    - src/admin/components/billing/BillingForm.js (Plan 03 consumer — exchangeCredit prop)
tech_stack:
  added: []
  patterns:
    - flushSync + ref + generateInvoicePdf(a5) for hidden DOM PDF capture
    - useNavigate with route state for cross-page data handoff
    - two-step customer name search (ilike customers, then bills.in) — PostgREST safe
    - read-modify-write stock restock (matches existing BillTable pattern)
key_files:
  created: []
  modified:
    - src/admin/components/billing/ReturnReceiptView.js
    - src/admin/pages/ExchangePage.js
decisions:
  - "Two-step customer name search (find customerids, then bills) instead of PostgREST !inner join — avoids ambiguity (A1 fallback taken)"
  - "graceful degradation for manual_items.stock lookup: console.warn + continue if column absent (migration_14 guard)"
  - "store_credit guarded by if (loadedBill.customerid) — no-customer bills skip credit update, still restock + PDF (Pitfall 5)"
  - "route state shape: { openNewBill: true, exchangeCredit: { amount, label }, prefilledCustomerId } — contract for Plan 03"
metrics:
  duration: "~25 minutes"
  completed: "2026-04-21"
  tasks_completed: 3
  tasks_total: 3
  files_created: 0
  files_modified: 2
---

# Phase 06 Plan 02: Exchange UI + Orchestration Summary

**One-liner:** Full ExchangePage (bill search, item selection, confirm flow: restock + exchanges insert + store credit + A5 PDF + route-state handoff) plus ReturnReceiptView extended with cancel/exchange mode prop.

## What Was Built

### ReturnReceiptView — mode prop (Task 1)

`src/admin/components/billing/ReturnReceiptView.js` extended with `mode = "cancel"` default prop:

| mode | Title | Items table | Footer note |
|------|-------|-------------|-------------|
| `"cancel"` (default) | STORE CREDIT RECEIPT | Item / Qty / MRP | "Store credit has been added..." (existing) |
| `"exchange"` | EXCHANGE RECEIPT | Item / Qty / MRP / Credit | "Store credit of ₹X has been added to your account." |

Exchange mode also shows `size / color` inline below product name in the items column. All existing call sites unaffected — default preserves cancel behavior.

### ExchangePage — search + item selection (Task 2)

`src/admin/pages/ExchangePage.js` replaced stub with full UI:

- **Search:** text input queries `bills` by `bill_number` ilike (finalized only). If no hits, falls back to two-step customer name search (ilike `customers`, then `bills.in(customerids)`).
- **Load bill:** fetches `bill_items` + existing `exchanges` for that bill, calls `computeMaxReturnQty` to get returnable items (already-returned qty excluded). Items with `maxReturnQty = 0` are filtered out.
- **Item selection grid:** 12-column grid — item name/variant, MRP, available qty, return qty input (capped `max={bi.maxReturnQty}`), reason text input, live credit preview via `calcItemCredit`.
- **Totals bar:** live `Items selected` count + `Total Credit` sum.
- **Review & Confirm button:** disabled until at least one item selected.

### ExchangePage — confirm flow (Task 3)

Full confirm orchestration in `handleConfirm`:

1. **Restock inventory** — `productsizecolors.update({ stock: variant.stock + returnQty })` per item with `variantid`
2. **Restock manual items** — `manual_items.update({ stock: mi.stock + returnQty })` per item with `manual_item_id`; graceful `console.warn + continue` if migration_14 column absent
3. **Insert exchanges** — one row per returned item: `original_bill_item_id`, `quantity`, `reason`, `customerid`, `credit_amount`, `voucher_id: null`
4. **Update store credit** — `customers.update({ store_credit: newBalance })` guarded by `if (loadedBill.customerid)`
5. **Generate PDF** — `flushSync` renders hidden `ReturnReceiptView mode="exchange"` off-screen; `generateInvoicePdf(receiptRef.current, "a5")` -> `window.open(blobUrl, "_blank")`
6. **Navigate** — `navigate("/admin/bills", { state: { openNewBill: true, exchangeCredit: { amount, label }, prefilledCustomerId } })`

Confirmation Dialog shows item summary with per-item credit, total, and amber warning when no customer on bill.

## Route State Contract (for Plan 03)

```js
// Emitted by ExchangePage on confirm success:
{
  openNewBill: true,
  exchangeCredit: {
    amount: number,          // total credit (sum of all returned item credits)
    label: string,           // "Return Credit — Bill #BC25001"
  },
  prefilledCustomerId: string | null,  // loadedBill.customerid
}
```

Plan 03 (BillingPage/BillingForm) reads this via `useLocation().state` on mount, auto-opens BillingForm, and applies `exchangeCredit` as a post-GST deduction.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 — ReturnReceiptView mode | a7c917c | feat(06-02): add mode prop to ReturnReceiptView for exchange receipts |
| 2 — ExchangePage search/selection | 5ec22f8 | feat(06-02): ExchangePage search + item selection + credit preview |
| 3 — ExchangePage confirm flow | 3cc155f | feat(06-02): ExchangePage confirm -> restock + exchanges insert + store_credit + PDF + route-state handoff |

## Deviations from Plan

### Auto-selected fallback (A1)

**Found during:** Task 2 (search implementation)
**Issue:** Plan noted PostgREST `!inner` join filter on related table columns may have syntax ambiguity.
**Fix:** Used two-step customer name search (query `customers` for matching ids, then `bills.in(ids)`) as the A1 fallback documented in RESEARCH.md.
**Files modified:** `src/admin/pages/ExchangePage.js`
**Commit:** 5ec22f8

No other deviations — all tasks executed per plan spec.

## Known Stubs

None. All functionality fully implemented. `handleConfirm` placeholder from Task 2 replaced in Task 3.

## Threat Surface Scan

New surfaces introduced:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: user-controlled search input | ExchangePage.js | `searchQuery` interpolated into `.ilike('bill_number', '%${q}%')` and `.or('first_name.ilike.%${q}%,...')` — both go through Supabase JS client which parameterizes values; no raw SQL concat. T-06-12 mitigated. |
| threat_flag: qty input tampering | ExchangePage.js | `handleQtyChange` clamps to `Math.max(0, Math.min(n, max))` where max = DB-derived `maxReturnQty`. T-06-10 mitigated. |
| threat_flag: credit_amount client-computed | ExchangePage.js | `calcItemCredit` uses DB-fetched bill_items fields (mrp, discount_total, alteration_charge); only user input is returnQty (clamped). T-06-11 mitigated. |

All threats covered by T-06-10 through T-06-15 in plan threat model.

## Self-Check: PASSED

- `src/admin/components/billing/ReturnReceiptView.js` — exists, contains `mode = "cancel"`, `EXCHANGE RECEIPT`, `Credit` header, size/color inline, exchange note
- `src/admin/pages/ExchangePage.js` — exists, >300 lines, all acceptance criteria patterns present
- Commits a7c917c, 5ec22f8, 3cc155f — present in git log
- `npm run build` — succeeded (no errors)
