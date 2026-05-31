# Supplier Pipeline Enhancement — Design Spec
**Date:** 2026-05-30

## Goal

Strengthen the existing supplier ledger system with: richer supplier profile (GSTIN, PAN, address, opening balance), full GST-compliant bill capture (invoice number, tax breakdown), payment mode tracking, advance transaction type, and a drill-down ledger UI inside an inline accordion on the suppliers table.

---

## Current State

Already built and working:
- `suppliers` table: name, phone, email, notes
- `supplier_transactions` table: type (bill/payment), amount, date, notes
- `supplier_bills` table: bill image linked to transaction
- `SupplierTransactionDialog`: record bill or payment with optional image upload
- `SupplierLedgerDialog`: running balance ledger in a modal
- `SupplierTable`: shows suppliers with computed balance, buttons to add transaction / view ledger

---

## Database Changes

### `suppliers` table — add columns

| Column | Type | Notes |
|--------|------|-------|
| `gstin` | `VARCHAR(15)` | nullable |
| `pan` | `VARCHAR(10)` | nullable |
| `address` | `TEXT` | nullable |
| `opening_balance` | `DECIMAL(12,2)` | default 0. Positive = we owe them. Negative = they owe us. |

### `supplier_transactions` table — add columns

| Column | Type | Notes |
|--------|------|-------|
| `invoice_number` | `VARCHAR(50)` | nullable; populate for bill type |
| `taxable_amount` | `DECIMAL(12,2)` | nullable; bill type only |
| `cgst_amount` | `DECIMAL(12,2)` | nullable; bill type only |
| `sgst_amount` | `DECIMAL(12,2)` | nullable; bill type only |
| `igst_amount` | `DECIMAL(12,2)` | nullable; bill type only (inter-state) |
| `payment_mode` | `VARCHAR(20)` | nullable; payment/advance only. Values: cash, upi, bank, cheque |

### Type enum — extend

Add `advance` to the existing `bill | payment` enum:
- `bill` — goods received, we owe (debit)
- `payment` — settled amount (credit)
- `advance` — payment before goods received (credit)

---

## Ledger Computation

```
running_balance = opening_balance
                + SUM(bill amounts)
                - SUM(payment amounts)
                - SUM(advance amounts)
```

- Positive balance = we owe the supplier
- Negative balance = supplier owes us (overpaid / excess advance)
- Opening balance treated as the first row in ledger (no date, labelled "Opening Balance")

---

## UI Changes

### SupplierForm (add/edit supplier)
Add fields: GSTIN, PAN, address (textarea), opening balance (number, signed).
Opening balance only editable on first save (or superadmin override — keep simple for now, just allow editing).

### SupplierTable — Inline Accordion

Remove "View Ledger" dialog. Clicking a supplier row expands an inline accordion below it.

Accordion header (summary bar):
```
Total Billed: ₹X    Total Paid: ₹Y    Net Balance: ₹Z (owed / credit)
```

Accordion body — ledger table:
```
Date | Type      | Invoice No | Debit (Bill) | Credit (Paid) | Balance
-----|-----------|------------|--------------|---------------|--------
     | Opening   |            |              |               | ₹X
date | Bill      | 033/26-27  | ₹6,545       |               | ₹X
date | Payment   |            |              | ₹3,000        | ₹X
date | Advance   |            |              | ₹2,000        | ₹X
```

- Click a **bill row** → inline expansion shows: invoice no, taxable amount, CGST, SGST, IGST, bill image link
- Click a **payment/advance row** → inline expansion shows: payment mode, notes
- [Add Bill] and [Add Payment] buttons at top of accordion

### SupplierTransactionDialog — updated forms

**Bill form fields:**
- Type (bill selected)
- Invoice Number (text, optional but recommended)
- Invoice Date
- Taxable Amount (₹)
- CGST (₹), SGST (₹), IGST (₹) — optional, shown collapsed under "GST Details"
- Total Amount (₹) — auto-computed from taxable + CGST + SGST + IGST, or manually entered
- Notes
- Bill Image (upload)

**Payment / Advance form fields:**
- Type (payment / advance)
- Amount (₹)
- Payment Mode (cash / UPI / bank transfer / cheque)
- Date
- Notes

---

## Migration File

`schema/migration_supplier_pipeline.sql` — adds all new columns, no destructive changes.

---

## Out of Scope

- Per-bill payment allocation (which payment settles which bill) — running balance sufficient
- Automated GST reconciliation / GSTR-2A matching
- Supplier portal / external access
