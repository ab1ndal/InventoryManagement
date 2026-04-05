# Requirements — v1.0 Update Billing

## Bill States

Bills follow this lifecycle:
- **Draft** → stock is subtracted immediately (inventory reserved)
- **Finalized** → stock stays subtracted, requires payment info, generates saved PDF invoice
- **Cancelled** → stock restored, voucher PDF issued to customer

---

## BILL — Core Persistence

- [x] **BILL-01**: User can save a new bill as Draft (inserts `bills` + `bill_items`, `paymentstatus='draft'`)
- [x] **BILL-02**: User can update an existing Draft bill (reconciles `bill_items`, adjusts stock delta)
- [x] **BILL-03**: User can load an existing bill into BillingForm (customer, items, salespersons, applied discounts pre-populated)
- [ ] **BILL-04**: User can Finalize a draft bill (requires payment info, sets `finalized=true`, `paymentstatus='finalized'`, records discount usage)
- [ ] **BILL-05**: User can Cancel a bill (sets `paymentstatus='cancelled'`, restores stock, issues voucher)

## STOCK — Inventory Management

- [x] **STOCK-01**: Saving a Draft subtracts quantity from `productsizecolors.stock` for each inventory item (variantid present)
- [x] **STOCK-02**: Updating a Draft reconciles stock — restores old quantities and subtracts new quantities for changed items
- [ ] **STOCK-03**: Cancelling a bill restores stock for all inventory items on that bill

## CUST — Customer Tracking

- [ ] **CUST-01**: Finalizing a bill updates `customers.total_spend` (+= grandTotal) and `customers.last_purchased_at` (= today)

## UI — Form Improvements

- [ ] **UI-01**: Dropdowns in BillingForm render with correct opacity (no transparent/washed-out background)
- [ ] **UI-02**: Manual item form has full field parity with inventory items: name, product code (optional), category, size, color, qty, MRP, alteration charge, GST rate
- [x] **UI-03**: Bill form includes a Salesperson(s) selector — staff can associate one or more salespersons with the sale

## SCHEMA — Database Additions

- [ ] **SCHEMA-01**: Add `payment_method` (text: cash/card/upi/mixed) and `payment_amount` (numeric) columns to `bills`
- [ ] **SCHEMA-02**: Add `salespersons` table (salesperson_id serial, name text, active boolean) and `bill_salespersons` junction table (billid FK, salesperson_id FK)

## PRINT — PDF Invoice

- [ ] **PRINT-01**: Finalized bill generates a PDF invoice showing: store header, bill ID, date, customer, salespersons, itemized table (name, size, color, qty, MRP, item discount, GST, total), overall discounts, GST total, grand total, payment method
- [ ] **PRINT-02**: PDF invoice is saved to Supabase Storage; `bills.pdf_url` is updated
- [ ] **PRINT-03**: User can view/reprint saved PDF invoice from BillTable (opens pdf_url)
- [ ] **PRINT-04**: Invoice layout is A4-optimized with print-specific CSS (navbar/buttons hidden on print)

## VOUCH — Cancellation Voucher

- [ ] **VOUCH-01**: Cancelling a finalized or draft bill creates a voucher in the `vouchers` table (value = grandTotal, expiry = 1 year, source='exchange')
- [ ] **VOUCH-02**: Cancellation generates a printable voucher PDF showing voucher code, value, expiry date, and store branding

---

## Future Requirements (Deferred)

- Stock decrement on finalize (deferred — stock already subtracted on draft save)
- Customer spending portal with loyalty badging (next milestone)
- Sales commission reports per salesperson (next milestone)
- Payment reconciliation / cash register totals
- Email invoice to customer
- Partial payments / split payment methods

## Out of Scope

- QZ Tray printing — browser PDF print chosen instead
- Customer-facing invoice portal
- Payment gateway integration

## Traceability

| REQ-ID | Phase |
|--------|-------|
| BILL-01 | Phase 1 |
| BILL-02 | Phase 1 |
| BILL-03 | Phase 1 |
| STOCK-01 | Phase 1 |
| STOCK-02 | Phase 1 |
| UI-01 | Phase 2 |
| UI-02 | Phase 2 |
| UI-03 | Phase 2 |
| SCHEMA-01 | Phase 2 |
| SCHEMA-02 | Phase 2 |
| BILL-04 | Phase 3 |
| CUST-01 | Phase 3 |
| PRINT-01 | Phase 3 |
| PRINT-02 | Phase 3 |
| PRINT-03 | Phase 3 |
| PRINT-04 | Phase 3 |
| BILL-05 | Phase 4 |
| STOCK-03 | Phase 4 |
| VOUCH-01 | Phase 4 |
| VOUCH-02 | Phase 4 |
