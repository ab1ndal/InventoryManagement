# Partial Payments Design

**Date:** 2026-04-25  
**Status:** Approved

## Problem

Customers with alteration orders pay a deposit upfront and the remainder on pickup. Current system requires payment within ₹100 of total at finalization — no way to record partial payment or hold goods until paid in full.

## Requirements

1. Bill can be finalized with partial payment → `paymentstatus = 'partial'`
2. Multiple payment installments supported (different methods per payment)
3. Goods withheld until cumulative payments reach net amount
4. Initial payment must be ≥ total value of all items with alteration charges
5. Invoice shows payment history, balance due, and "goods withheld" warning
6. When fully paid: status flips to `finalized`, final invoice reprinted

---

## Section 1 — Database

### New table: `bill_payments`

```sql
CREATE TABLE bill_payments (
  payment_id    serial PRIMARY KEY,
  billid        integer NOT NULL REFERENCES bills(billid),
  amount        numeric(10,2) NOT NULL,
  salesmethodid integer NOT NULL REFERENCES salesmethods(salesmethodid),
  recorded_at   timestamp WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes         text
);
CREATE INDEX idx_bill_payments_billid ON bill_payments(billid);
```

### `bills` table

No new columns required.

- `payment_amount`: kept for backward-compat with existing finalized bills (pre-feature). New bills written via `bill_payments`.
- `paymentstatus`: varchar — already supports arbitrary values. New value: `'partial'`.
- `finalized`: `true` even for partial bills (items/discounts locked after first payment).

### Status values

| Value | Meaning |
|-------|---------|
| `draft` | Not yet finalized, editable |
| `partial` | First payment received, items locked, goods held |
| `finalized` | Fully paid, goods released |
| `cancelled` | Voided |

---

## Section 2 — Finalization Logic

### Full payment path (existing, unchanged)
- Staff enters amount within ₹100 of net payable → "Finalize" → `paymentstatus='finalized'`

### Partial payment path (new)
- Staff enters amount less than net payable (beyond ₹100 shortfall) → "Partial Payment" button appears
- On confirm: `finalized=true`, `paymentstatus='partial'`, writes row to `bill_payments`
- Balance discount logic (`balanceAdjustedComputed`) does NOT apply to partial bills — total is not rounded down

### Alteration deposit validation
- Computed: `alterationMinDeposit = Σ priceItem(it).total` for items where `alteration_charge > 0`
- If `alterationMinDeposit > 0` and `initialPayment < alterationMinDeposit`: block with error
- Error message: "Initial payment must be at least ₹{X} to cover altered items"

### Adding subsequent payments (partial bills)
- Staff opens partial bill in BillingForm → read-only items view + "Add Payment" section
- Staff enters amount + selects payment method
- `totalPaid = Σ bill_payments.amount (for this bill)`
- If `totalPaid >= net_amount`: flip `paymentstatus='finalized'`, `finalized=true`, trigger PDF/print
- If still short: add row to `bill_payments`, remain `partial`

### net_amount for partial bills
- Computed same as today: `grandTotal - storeCreditUsed - exchangeCreditUsed`
- Stored in `bills.net_amount` on first finalization (partial or full)

---

## Section 3 — Invoice Changes

### Partial invoice (`paymentstatus='partial'`)

**Payment history block** (above payment footer):
```
Payment History:
  10 Apr 2026 | Cash       | ₹500
  Balance Due              | ₹1,200
```

**Warning box** (prominent, red/amber):
```
⚠ GOODS WILL NOT BE RELEASED UNTIL PAYMENT IN FULL
```

### Final invoice (`paymentstatus='finalized'` with multiple payments)

**Payment history block**:
```
Payment History:
  10 Apr 2026 | Cash       | ₹500
  20 Apr 2026 | UPI        | ₹1,200
  Total Paid               | ₹1,700  ✓ PAID IN FULL
```

No warning box.

### Single-payment finalized bills (backward compat)
- No payment history block (falls back to existing "Amount Received" footer)
- Detected by: `bill_payments` rows = 0, use `bills.payment_amount`

---

## Section 4 — UI Changes

### BillingForm

**Finalization section changes:**
- Payment amount input: no cap on shortfall
- If shortfall > ₹100: show "Partial Payment" button alongside existing "Finalize" button
- "Finalize" button only active if within ₹100 (full payment, existing behavior)

**Partial bill view:**
- Items/discounts: read-only (same as current finalized bill)
- New "Payments" section replaces payment input:
  - Table of past payments (date, method, amount)
  - "Add Payment" form (amount + method selector)
  - Shows: Total Paid, Balance Due
- "Record Payment" button → saves to `bill_payments`, rechecks if fully paid

### BillTable

- New amber badge for `partial` status
- Balance due shown in row (or tooltip) for partial bills
- Column: `Net Amount | Paid | Balance`

---

## Out of Scope

- Refunds on partial bills (use existing cancel/exchange flow)
- Partial payment on exchange bills (exchange credit still applied at bill creation)
- Notifications/reminders to customers for outstanding balance
