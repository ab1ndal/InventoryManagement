# Phase 6: Exchange and Returns — Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the Exchange & Returns flow: staff search for a finalized bill on ExchangePage, select items to return (any subset, any partial quantity), restock those items, issue store credit, print a return confirmation PDF, and open BillingForm pre-loaded with the exchange credit as an Additional Discount so staff can immediately ring up the replacement purchase.

No new capabilities beyond this flow. Cancel (full-bill soft-cancel) remains in BillTable — this phase handles partial item returns and exchange billing.

</domain>

<decisions>
## Implementation Decisions

### Exchange Entry Point
- **D-01:** Exchange is initiated from **ExchangePage** (`src/admin/pages/ExchangePage.js` — currently a stub). ExchangePage is the dedicated hub: staff search a bill by bill number or customer name, load the bill, then proceed to item selection.
- **D-02:** Only **finalized bills** (`paymentstatus = 'finalized'`) are eligible for exchange. Draft and cancelled bills are excluded from search results.
- **D-03:** No BillTable action button for exchange in this phase — ExchangePage is the sole entry point.

### Return Scope & Item Selection
- **D-04:** Staff can return **any subset of items** from the bill, including **partial quantities** per line item (e.g., return 1 of 3 of the same item). The UI presents each bill_item row with a quantity input (0 to max qty on that item).
- **D-05:** **Manual items are returnable.** Manual items (no `variantid`) need a new `stock` column on `manual_items` (see schema section). On return, `manual_items.stock += returned_qty`. The migration adds `stock integer not null default 1` — staff can adjust the value via the manual item record as needed.
- **D-06:** Restock for inventory items: `UPDATE productsizecolors SET stock = stock + returned_qty WHERE variantid = X`. Same pattern as cancel restock in BillTable.js.

### Exchange Record
- **D-07:** For each returned item, insert a row into the `exchanges` table: `original_bill_item_id`, `quantity` (returned), `reason` (optional free-text), `customerid`, `credit_amount` (= item's total credit value). `voucher_id` is left null — store credit goes to `customers.store_credit`, not `vouchers`.
- **D-08:** `credit_amount` per item = `(mrp × returned_qty) - item_discount + alteration_charge_proportional`. GST is included in the credit (full item value returned). Total exchange credit = sum of all per-item credit_amounts.

### Store Credit
- **D-09:** After recording exchanges and restocking, `customers.store_credit += total_credit_amount`. Consistent with D-14 from Phase 4 — store credit lives in `customers.store_credit`, not the `vouchers` table.
- **D-10:** Store credit is added immediately on exchange confirmation, before the new bill is opened. If the new bill is abandoned, the store credit remains on the customer account for future use.

### Return Confirmation PDF
- **D-11:** Reuse **`ReturnReceiptView`** (A5, `src/admin/components/billing/ReturnReceiptView.js`) — extend it to handle both cancellation receipts (existing) and exchange receipts (new). Pass a `mode` prop or similar to distinguish.
- **D-12:** Exchange return receipt content: store header (name, address, GSTIN, phone), original bill number, date of exchange, customer name, table of returned items (name, size, color, qty, credit value per item), total credit amount, and a note: "Store credit of ₹X has been added to your account."
- **D-13:** PDF generated immediately after exchange is confirmed (same html2canvas + jsPDF + `generateInvoicePdf.js` pattern). Opens in new tab for printing. NOT saved to Supabase Storage.

### New Bill Generation
- **D-14:** After exchange is confirmed and PDF is printed, **open BillingForm** with the exchange credit pre-applied as an "Additional Discount" line item. The discount is labeled with the original bill number: e.g., `"Return Credit — Bill #BC25001"`.
- **D-15:** `credit_amount` = total exchange credit (sum of all returned item credits). This appears as a deduction in the bill summary, separate from discount codes and promotional vouchers. The existing deduction order: item discounts → discount codes → promotional voucher → store credit → additional discount (exchange credit). Floor at 0 — no cashback.
- **D-16:** The "Additional Discount" is local state in BillingForm — it is NOT a `discounts` table row and NOT a `vouchers` table row. It is tracked as `exchangeCredit: { amount, label }` state and applied in `computeBillTotals()` or as a post-computation deduction (same pattern as `appliedStoreCredit`).
- **D-17:** The new bill pre-fills the **same customer** as the original bill (if customer was on original bill). Staff can change if needed.
- **D-18:** If staff close BillingForm without finalizing, no further action needed — the `customers.store_credit` already has the credit (D-10). The exchange is complete regardless of whether a new bill is created.

### Schema Changes
- **D-19:** Add `stock integer not null default 1` column to `manual_items` table via migration. Provide as `schema/migration_14_manual_items_stock.sql`.
- **D-20:** No other schema migrations needed — `exchanges` table already exists with all required columns.

### Claude's Discretion
- Bill search UI on ExchangePage (search input style, results display) — standard patterns consistent with rest of app
- Confirmation dialog copy and layout for exchange summary before confirming
- How to handle exchange of a bill with no associated customer (exchange still proceeds; store credit skipped; PDF still prints without customer name)
- Error handling for partially-failed restock operations

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema
- `schema/exchanges.sql` — exchanges table structure (exchangeid, original_bill_item_id, quantity, reason, customerid, credit_amount, voucher_id)
- `schema/manual_items.sql` — manual_items table (gets new stock column in this phase)
- `schema/customers.sql` — customers table (store_credit column, already exists)
- `schema/bills.sql` — bills table structure and paymentstatus values
- `schema/bill_items.sql` — bill_items structure (variantid nullable, mrp, quantity, alteration_charge, etc.)
- `schema/SCHEMA_GUIDE.md` — domain map and key relationships

### Billing Components (patterns to reuse)
- `src/admin/components/billing/ReturnReceiptView.js` — A5 return receipt (extend for exchange mode)
- `src/admin/components/billing/generateInvoicePdf.js` — html2canvas + jsPDF pattern
- `src/admin/components/billing/BillingForm.js` — main billing form (add exchangeCredit state + deduction)
- `src/admin/components/billing/billUtils.js` — computeBillTotals() (exchange credit deduction to add)
- `src/admin/components/billing/Summary.js` — deduction rows (add exchange credit row)
- `src/admin/components/billing/stockHelpers.js` — stock helpers (restock pattern)

### Exchange Page & BillTable
- `src/admin/pages/ExchangePage.js` — stub to implement
- `src/admin/components/BillTable.js` — cancel/restock patterns to replicate

### Prior Phase Context
- `.planning/phases/04-cancel-voucher-pdf/04-CONTEXT.md` — D-14 (store credit in customers.store_credit, not vouchers), D-7 (stock restore pattern), D-11 to D-13 (ReturnReceiptView design)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ReturnReceiptView.js`: A5 return receipt component, already renders store branding and store credit messaging — extend with `mode="exchange"` prop
- `generateInvoicePdf.js`: `generateInvoicePdf(ref, format)` — same call pattern for exchange PDF
- `stockHelpers.js` → `computeStockDelta`: restock pattern mirrors what BillTable.handleCancelFinalized does
- `BillingForm.js`: `appliedStoreCredit` state pattern — `exchangeCredit` follows same structure
- `Summary.js`: existing deduction rows for store credit + voucher — exchange credit adds a 3rd row

### Established Patterns
- Store credit: local state + `UPDATE customers SET store_credit = store_credit - X` on finalize
- Stock restore: `UPDATE productsizecolors SET stock = stock + qty WHERE variantid = X`
- PDF: html2canvas captures a ref, jsPDF saves → opens in new tab
- Supabase direct calls from component effects/handlers — no API layer

### Integration Points
- `ExchangePage.js` → bill search → item selection → confirm → open `BillingForm` (via route state or modal)
- `BillingForm.js` → new `exchangeCredit` prop/state → deduction in `computeBillTotals` flow
- `exchanges` table insert on confirmation
- `manual_items.stock` column (new) → restock target for non-inventory returned items

</code_context>

<specifics>
## Specific Ideas

- Exchange credit label on bill: `"Return Credit — Bill #BC25001"` (uses bill_number field, not billid)
- Return receipt note: `"Store credit of ₹X has been added to your account."`
- ExchangePage search: by bill_number (text input) or customer name — load finalized bill matching criteria
- Per-item credit formula: `(mrp × returned_qty) - item_discount_amount + alteration_charge_proportional`
- BillingForm `exchangeCredit` state shape: `{ amount: number, label: string }` — consistent with `appliedStoreCredit` pattern

</specifics>

<deferred>
## Deferred Ideas

- BillTable shortcut button (quick-link to ExchangePage pre-filled) — noted for future if staff request it
- Saving return receipt PDF to Supabase Storage — one-time print only for now
- Exchange history view per customer — future CRM milestone
- Reason code dropdown for exchange (currently free text) — future enhancement

</deferred>

---

*Phase: 06-exchange-and-returns-bill-lookup-partial-item-credit-store-c*
*Context gathered: 2026-04-21*
