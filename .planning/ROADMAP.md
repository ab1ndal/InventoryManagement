# Roadmap — v1.0 Update Billing

**4 phases** | **20 requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Criteria |
|---|-------|------|--------------|----------|
| 1 | Draft & Stock | Save/update draft bills with live inventory reservation | BILL-01, BILL-02, BILL-03, STOCK-01, STOCK-02 | 4 |
| 2 | Form Polish | Fix UI issues, manual items, salesperson input, schema additions | UI-01, UI-02, UI-03, SCHEMA-01, SCHEMA-02 | 4 |
| 3 | Finalize & PDF | Payment info, customer spend update, PDF invoice saved to storage | BILL-04, CUST-01, PRINT-01–04 | 5 |
| 4 | Cancel & Voucher | Cancel bill, restore stock, issue & print voucher PDF | BILL-05, STOCK-03, VOUCH-01, VOUCH-02 | 4 |

---

## Phase 1: Draft & Stock Management

**Goal:** Saving a Draft bill writes to Supabase and immediately subtracts inventory stock.

**Requirements:** BILL-01, BILL-02, BILL-03, STOCK-01, STOCK-02

**Success criteria:**
1. "Save Draft" inserts a `bills` row (`paymentstatus='draft'`, `finalized=false`) and `bill_items` rows; toast confirms with bill ID
2. Inventory items' stock in `productsizecolors` is decremented by qty on draft save
3. Updating a draft reconciles stock — old qtys restored, new qtys subtracted (handles item removal/quantity changes)
4. "Edit" in BillTable opens BillingForm with customer, items, discounts pre-populated

**Key implementation notes:**
- `bills` insert: customerid, notes, totalamount, gst_total, discount_total, taxable_total, paymentstatus='draft', finalized=false
- `bill_items` insert: billid, quantity, mrp, variantid (nullable for manual), product_name, product_code, category, alteration_charge, discount_total (item-level), subtotal, gst_rate, gst_amount, total
- Stock: `UPDATE productsizecolors SET stock = stock - qty WHERE variantid = X` (skip if variantid null = manual item)
- For draft update: fetch existing bill_items, compute stock delta per variantid (old qty − new qty), apply delta
- Load for edit: fetch `bills` + `bill_items` + `discount_usage` where billid=X; reconstruct items array matching BillingForm shape
- `computeBillTotals` in `billUtils.js` provides all total values needed for the bills row

---

## Phase 2: Form Polish & Schema Additions

**Goal:** Fix dropdown visibility, make manual items first-class, add salesperson support.

**Requirements:** UI-01, UI-02, UI-03, SCHEMA-01, SCHEMA-02

**Success criteria:**
1. All dropdowns/selects in BillingForm have solid, opaque backgrounds (no washed-out/transparent look)
2. Manual item form has: name (required), product code (optional), category, size, color, qty, MRP, alteration charge, GST rate — identical UX to inventory-sourced items
3. Bill form has a Salesperson(s) multi-select; selected names are saved to `bill_salespersons`
4. `payment_method` and `payment_amount` columns exist on `bills` table (SQL migration script provided)
5. `salespersons` and `bill_salespersons` tables exist (SQL migration script provided)

**Key implementation notes:**
- Dropdown opacity: likely a Tailwind `bg-white`/`bg-popover` missing on Select content — inspect `src/components/ui/select.tsx` and `CustomerSelector.js`
- Manual item: `ManualItemForm.js` exists but may be incomplete — align fields with `normalizeItem()` in billUtils.js which expects: qty, mrp, quickDiscountPct, alteration_charge, gstRate
- Salesperson schema:
  ```sql
  CREATE TABLE salespersons (
    salesperson_id serial PRIMARY KEY,
    name text NOT NULL,
    active boolean DEFAULT true
  );
  CREATE TABLE bill_salespersons (
    billid integer REFERENCES bills(billid) ON DELETE CASCADE,
    salesperson_id integer REFERENCES salespersons(salesperson_id),
    PRIMARY KEY (billid, salesperson_id)
  );
  ```
- Payment schema:
  ```sql
  ALTER TABLE bills ADD COLUMN payment_method text CHECK (payment_method IN ('cash','card','upi','mixed'));
  ALTER TABLE bills ADD COLUMN payment_amount numeric(10,2);
  ```
- Populate `salespersons` table with seed data (or provide UI to add them in a future milestone)

---

## Phase 3: Finalize with Payment + PDF Invoice

**Goal:** Finalizing a bill collects payment, updates customer records, generates a PDF saved to Supabase Storage.

**Requirements:** BILL-04, CUST-01, PRINT-01, PRINT-02, PRINT-03, PRINT-04

**Success criteria:**
1. "Finalize" button opens a payment modal — staff selects payment method and confirms amount
2. On confirm: bill updated (`finalized=true`, `paymentstatus='finalized'`, payment_method/amount set), discount_usage rows inserted per applied code
3. Customer's `total_spend` incremented and `last_purchased_at` set to today
4. Invoice PDF is generated and uploaded to Supabase Storage bucket; `bills.pdf_url` updated
5. BillTable shows a "Print" icon on finalized rows; clicking opens the saved PDF in a new tab or triggers browser print
6. Invoice renders correctly: store header, bill ID, date, customer info, salesperson(s), line items table, discounts, GST breakdown, grand total, payment info

**Key implementation notes:**
- PDF generation: render an `InvoiceView` React component hidden on screen, use `html2canvas` + `jsPDF` OR use `window.print()` with `@media print` CSS to capture just the invoice div
- Recommend `window.print()` approach (simpler, no extra deps): render invoice in a hidden `<div id="print-area">`, call `window.print()`, CSS hides everything except `#print-area` on print
- To save as PDF: use browser's "Save as PDF" print destination OR use `jsPDF` if programmatic upload is needed for pdf_url
- Supabase Storage: `supabase.storage.from('invoices').upload('bill-{id}.pdf', pdfBlob)` then `getPublicUrl`
- If using window.print() for display only (no storage), set `pdf_url = null` and add "Reprint" button that re-renders and prints — simpler than storage upload

---

## Phase 4: Cancel & Voucher PDF

**Goal:** Cancelling a bill restores inventory and issues a store credit voucher.

**Requirements:** BILL-05, STOCK-03, VOUCH-01, VOUCH-02

**Success criteria:**
1. Cancel button (on Draft or Finalized bills) shows confirmation dialog before proceeding
2. Cancelled bill: `paymentstatus='cancelled'`, stock restored for all inventory items, BillTable shows "Cancelled" badge
3. If customer is set on bill: a voucher is inserted into `vouchers` table (value = grandTotal, expiry = 1 year from today, source='exchange')
4. Voucher PDF is generated and displayed for printing (voucher code, value, expiry, store name/branding)
5. If no customer: stock is still restored, but no voucher is issued (inform staff)

**Key implementation notes:**
- Stock restore: fetch `bill_items` for the bill, `UPDATE productsizecolors SET stock = stock + qty WHERE variantid = X` for each item with a variantid
- Voucher: generate a ULID or UUID for `voucher_id`, insert into `vouchers` with source='exchange'
- Voucher PDF: same `window.print()` approach — render a `VoucherView` component and print
- Cancelling a finalized bill should also reverse `discount_usage` entries (delete where billid=X)
- Consider whether to reverse `customers.total_spend` on cancellation — recommended yes, subtract grandTotal

---

## Schema Migration Scripts

All required SQL migrations are documented in Phase 2 notes. Provide as `.sql` files in `schema/` directory for manual execution in Supabase dashboard.
