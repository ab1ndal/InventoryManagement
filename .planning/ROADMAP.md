# Roadmap — v1.0 Update Billing

**3 phases** | **9 requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|-----------------|
| 1 | Bill Persistence | Wire up Save Draft + Finalize to Supabase | BILL-01, BILL-02, BILL-03 | 3 |
| 2 | Edit & Print | Load existing bills for editing + PDF invoice print | BILL-04, PRINT-01, PRINT-02, PRINT-03 | 4 |
| 3 | Bill Lifecycle | Delete drafts and void finalized bills | MGMT-01, MGMT-02 | 3 |

---

## Phase 1: Bill Persistence

**Goal:** The Save Draft and Finalize buttons actually write data to Supabase.

**Requirements:** BILL-01, BILL-02, BILL-03

**Success criteria:**
1. Clicking "Save Draft" creates a new bill row + bill_item rows; toast confirms with bill ID
2. Clicking "Save Draft" on an existing draft updates bill + replaces bill_items (delete + re-insert)
3. Clicking "Finalize" sets `finalized=true` and inserts `discount_usage` rows for each applied code
4. BillTable refreshes after save/finalize and shows the new/updated bill

**Key implementation notes:**
- `bills` insert: customerid, notes, totalamount, gst_total, discount_total, taxable_total, finalized
- `bill_items` insert: billid, quantity, mrp, variantid (nullable), product_name, product_code, category, alteration_charge, discount_total (item-level), subtotal, gst_rate, gst_amount, total
- For edit: delete existing bill_items where billid=X, then re-insert
- `discount_usage` insert on finalize: one row per selected code (if customerid present)
- `computeBillTotals` in `billUtils.js` provides all total values

---

## Phase 2: Edit & Print

**Goal:** Staff can reopen an existing bill to edit it, and print a formatted PDF invoice.

**Requirements:** BILL-04, PRINT-01, PRINT-02, PRINT-03

**Success criteria:**
1. Clicking Edit in BillTable opens BillingForm with customer, items, and discounts pre-populated
2. Invoice shows: store header, bill ID, date, customer name/phone, itemized table (name, qty, MRP, discount, GST, total), discount summary, GST total, grand total
3. Clicking "Print Invoice" opens the browser print dialog with print-optimized layout (no navbar, A4)
4. Invoice renders correctly in print preview

**Key implementation notes:**
- Fetch: `bills` + `bill_items` + join to `productsizecolors`/`products` for variant display
- Fetch applied discounts from `discount_usage` where billid=X to pre-select codes
- Print: render an `InvoiceView` component, use `window.print()` with `@media print` CSS to hide nav/buttons
- BillingForm already accepts `billId` prop but doesn't load data — add a `useEffect` on `billId` to fetch

---

## Phase 3: Bill Lifecycle

**Goal:** Staff can delete draft bills and void finalized bills.

**Requirements:** MGMT-01, MGMT-02

**Success criteria:**
1. Delete button on draft bill row in BillTable shows confirmation dialog, then deletes bill (bill_items cascade)
2. Void button on finalized bill marks it as voided (new `voided` boolean column or status field)
3. Voided bills display with "Voided" badge in BillTable, distinct from Draft/Finalized
4. BillTable refreshes after delete/void

**Key implementation notes:**
- Delete: `supabase.from('bills').delete().eq('billid', id)` — cascade handles bill_items
- Void: requires either a `voided` column (schema migration) or repurposing `paymentstatus` = 'voided'
- Recommend using `paymentstatus = 'voided'` to avoid schema migration if possible
- Add action column buttons with confirmation before destructive actions
