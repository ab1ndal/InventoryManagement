# Requirements — v1.0 Update Billing

## Bill Persistence

- [ ] **BILL-01**: User can save a new bill as draft (writes to `bills` + `bill_items`, `finalized=false`)
- [ ] **BILL-02**: User can update an existing draft bill (overwrites `bill_items`, updates `bills` totals)
- [ ] **BILL-03**: User can finalize a bill (sets `finalized=true`, records discount usage in `discount_usage`)
- [ ] **BILL-04**: User can load an existing bill into the BillingForm for editing (fetches customer, items, applied discounts)

## PDF Invoice & Print

- [ ] **PRINT-01**: User can generate a printable invoice showing bill details (customer, items, discounts, GST, total)
- [ ] **PRINT-02**: User can trigger the browser print dialog from the invoice view
- [ ] **PRINT-03**: Invoice is formatted for A4 paper with print-specific CSS (no nav, proper layout)

## Bill Lifecycle

- [ ] **MGMT-01**: User can delete a draft bill from BillTable (hard delete, cascades to `bill_items`)
- [ ] **MGMT-02**: User can void a finalized bill (marks bill as voided so it's excluded from reports)

## Future Requirements

- Payment method tracking (cash, card, UPI) on finalization
- Stock decrement on finalization
- Customer `total_spend` + `last_purchased_at` update on finalization
- Email invoice to customer

## Out of Scope

- QZ Tray printing — user was unsuccessful; browser PDF print chosen instead
- Customer-facing invoice portal
- Payment gateway integration

## Traceability

| REQ-ID | Phase |
|--------|-------|
| BILL-01 | Phase 1 |
| BILL-02 | Phase 1 |
| BILL-03 | Phase 1 |
| BILL-04 | Phase 2 |
| PRINT-01 | Phase 2 |
| PRINT-02 | Phase 2 |
| PRINT-03 | Phase 2 |
| MGMT-01 | Phase 3 |
| MGMT-02 | Phase 3 |
