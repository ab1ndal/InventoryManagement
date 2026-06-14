# Edit Supplier Transactions + Currency Display Polish

## Problem

`SupplierTransactionDialog.js` only supports creating new supplier
transactions (bill/payment/advance). Once a bill is recorded — including its
line items and uploaded image — there's no way to fix a typo, correct an
amount, or re-link the bill document. `SupplierTransactionsTab.js` shows
transactions read-only.

Additionally, the dialog (`max-w-md`) is too narrow for the line-items table
(7 columns), and numeric amount inputs show raw numbers with no INR
formatting feedback.

## Goals

1. Edit any existing `supplier_transactions` row (bill, payment, or advance)
   — amount, date, notes, payment mode, and for bills: invoice number, GST
   breakdown, line items, and bill image/PDF.
2. Widen the dialog so the line-items table and GST grid have room.
3. Show a live INR-formatted preview next to amount-type number inputs.
4. Add `discount_pct` (per line item) and `round_off_amount` (per
   transaction) to match real supplier invoices — available in both create
   and edit forms.
5. Auto-calculate line item amount, taxable amount, and final bill total
   from their inputs (read-only, live-recomputed) instead of manual entry.

## Schema Migration

New file `schema/migration_supplier_bill_discount_roundoff.sql`:

```sql
-- Per-line discount % and transaction-level rounding adjustment, to match
-- supplier invoice formats (e.g. "Disc. % 10%", "Rounded Off (-)0.16")
ALTER TABLE supplier_bill_line_items ADD COLUMN IF NOT EXISTS discount_pct numeric;
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS round_off_amount numeric;
```

Both nullable, no default — optional fields, existing rows unaffected.

## Auto-calculated Totals (bill type only)

Replaces manual entry for three fields with live-computed, read-only
displays — recalculated via `form.watch` on every relevant keystroke.

| Field | Formula | Editable? |
|---|---|---|
| Line item `amount` | `qty × unit_price × (1 − (discount_pct \|\| 0) / 100)`, rounded to 2dp | No — computed cell, replaces the current `<Input>` |
| `taxable_amount` | `Σ line_items[].amount` — only when `line_items.length > 0` | No when line items exist. If `line_items.length === 0` (legacy/no-line-item bills), stays manually editable as today |
| `amount` (top-level, final total) | `taxable_amount + (cgst_amount \|\| 0) + (sgst_amount \|\| 0) + (igst_amount \|\| 0) + (round_off_amount \|\| 0)`, rounded to 2dp | No, for `type === "bill"`. For `payment`/`advance`, `amount` stays the only field and remains manually entered (no taxable/GST concept) |

`gross_amount` / `discount_amount` (existing transaction-level fields)
remain manual/optional — used for suppliers who give one overall invoice
discount instead of per-line `discount_pct`. They are **not** part of the
`taxable_amount` computation (per-line discount already nets out in each
line's `amount`), purely informational/reference fields when both are
present.

CGST/SGST/IGST amounts (₹) remain manual entry — no rate fields added (per
earlier scope decision).

### zod schema changes

- `amount`: becomes `z.coerce.number()...` still present in schema (needed
  for payment/advance and as the submitted value for bills), but for bill
  type the form computes and writes it via `form.setValue("amount", ...,
  { shouldValidate: false })` rather than user typing into it — input
  rendered as disabled/read-only when `txnType === "bill"`.
- `taxable_amount`: same pattern — disabled when `line_items.length > 0`.
- `line_items[].amount`: schema keeps `z.coerce.number().nonnegative()`
  (still submitted), but the `<Input>` is replaced with a read-only
  `<span>`/disabled input showing the computed value; `form.setValue` keeps
  it in sync as `qty`/`unit_price`/`discount_pct` change.
- New: `line_items[].discount_pct: z.coerce.number().min(0).max(100).optional()`
- New: `round_off_amount: z.coerce.number().optional().nullable()` — **not**
  `.nonnegative()`, since round-off can be negative (as in the sample bill,
  `(-)0.16`).

### Line items table — new column

Add `Disc %` column between `Unit` and `Price`. `<Input type="number"
step="0.01" min="0" max="100">`, optional (blank = 0%). `Amount` column
becomes the computed read-only cell described above.

### Recalculation wiring

A `useEffect` watching `form.watch("line_items")` (qty, unit_price,
discount_pct per row) recomputes each row's `amount` via `form.setValue`,
then recomputes `taxable_amount` (sum), then recomputes top-level `amount`
(taxable + taxes + round_off) — same effect also watches
`cgst_amount`/`sgst_amount`/`igst_amount`/`round_off_amount` for the final
step. Guarded to bill type only (`txnType === "bill"`).

## Non-goals

- Changing `type` after creation (bill ↔ payment ↔ advance). Locked in edit
  mode — switching types would orphan line items / bill image records, and
  is out of scope for "simple edit/save".
- Deleting transactions.
- Diffing/patching individual line items — edit replaces the full set.

## UI Changes

### `SupplierTransactionsTab.js`

- New "Actions" column, last in the table. Every row gets an **Edit** button
  (icon button, pencil).
- `handleEditClick(t)`:
  1. If `t.type === "bill"`, fetch `supplier_bill_line_items` where
     `transaction_id = t.transaction_id`, and `supplier_bills` row (for
     `bill_id`, `image_url`, `storage_path`) for the same transaction.
  2. Set `editTransaction = { ...t, line_items, bill }`, open dialog with
     `mode="edit"`.

### `SupplierTransactionDialog.js`

New props: `mode` (`"create"` default | `"edit"`), `transaction` (existing
row + `line_items` + `bill`, only in edit mode).

**Dialog width**: `max-w-md` → `max-w-3xl`.

**Prefill (edit mode)**:
- `supplier` prop passed as `{ supplierid: transaction.supplier_id, name: transaction.suppliers?.name }`
  — `SupplierPicker` stays hidden (same as current locked-supplier path).
- `form.reset()` with all scalar fields from `transaction` on dialog open.
- `line_items` field array populated from `transaction.line_items` (mapped
  to the same shape used by `append`).
- If `transaction.bill` exists, show its `image_url` as a "Current file:
  [View ↗]" link above the file input. New file selection is optional —
  if left empty, existing bill record/file is untouched.

**Type field**: rendered as a disabled `<select>` in edit mode, showing the
current value, not submitted as part of the diff (value is read from
`transaction.type` server-side, never changed).

**Dialog title / submit label**:
- Title: `Edit Transaction — {supplier.name}` (edit) vs current `Add
  Transaction — ...` (create).
- Submit button: `"Save Changes"` (edit) vs current type-dependent label.

### Currency preview

Applies to fields that remain **manual numeric entry**: `gross_amount`,
`discount_amount`, `cgst_amount`, `sgst_amount`, `igst_amount`,
`round_off_amount`, line item `unit_price`, and (for `payment`/`advance`)
the main `amount`. Each renders a small `text-xs text-muted-foreground` line
below the `<Input type="number">` showing `formatINR(value, 2)` (reuse
`src/utility/formatCurrency.js`), updating live via `form.watch`. Empty/zero
values show nothing (avoid `₹0.00` clutter).

Computed read-only fields (line item `amount`, `taxable_amount`, and bill
`amount`) don't need a separate preview — they render `formatINR(value, 2)`
directly as their displayed content (no raw number shown).

## Data Flow — Save (edit mode)

```
handleSubmit(values):
  if mode === "edit":
    1. UPDATE supplier_transactions
       SET amount, transaction_date, notes, invoice_number, gross_amount,
           discount_amount, taxable_amount, cgst_amount, sgst_amount,
           igst_amount, payment_mode, round_off_amount
       WHERE transaction_id = transaction.transaction_id
       (type NOT included — stays as-is)

    2. if transaction.type === "bill":
       a. DELETE FROM supplier_bill_line_items WHERE transaction_id = ...
       b. INSERT new rows from values.line_items (if any), same mapping as
          create path plus discount_pct (product_id always null — re-linking happens via
          SupplierLedgerDialog's existing LineItemProductLink flow, which
          is unaffected since it's a separate update keyed on
          line_item_id... NOTE: re-insert generates new line_item_ids, so
          any existing product_id links on those line items are lost on
          edit. See "Known limitation" below.)

       c. if new file selected:
          - build filename via buildBillFilename (existing util)
          - upload to storage at `${supplier_id}/${filename}`, upsert: true
          - if transaction.bill exists: UPDATE supplier_bills SET
            image_url, storage_path, uploaded_at = now() WHERE
            bill_id = transaction.bill.bill_id
          - else: INSERT new supplier_bills row

    3. logActivity({ action: "update", entityType: "supplier_bill" |
       "supplier", entityId: transaction_id, summary: "Edited <type> for
       supplier <name> — <amount>" })

    4. toast.success("Transaction updated"), onSuccess?.()
```

## Create path — same field additions

The existing create path gets the same updates as part of this work:
`round_off_amount` included in the `supplier_transactions` insert,
`discount_pct` included in each `supplier_bill_line_items` insert, and the
same auto-calc/read-only wiring (Goal 5) applies in create mode too — so a
new bill's line amounts, taxable amount, and final total are computed the
same way as in edit mode.

## SupplierLedgerDialog — display updates

`src/admin/components/SupplierLedgerDialog.js` expanded bill row:
- Line items table gains a `Disc %` column (between `Unit` and `Price`),
  showing `li.discount_pct ? `${li.discount_pct}%` : "—"`.
- Transaction detail grid gains a `Round Off` cell (alongside
  Gross/Discount/Taxable/CGST/SGST/IGST), shown only when
  `row.round_off_amount` is non-null — `formatINR(row.round_off_amount, 2)`,
  with a `(-)` style match if negative (existing `formatINR` already handles
  negative numbers via `Intl.NumberFormat`).

## Known limitation

Step 2b re-inserts line items, generating fresh `line_item_id`s. Any
`product_id` links made via `SupplierLedgerDialog`'s "Link product" feature
on the old line items are dropped when the bill is edited. This is accepted
as part of "simple edit/save" — re-linking after an edit is a minor manual
step. A future improvement could match old→new rows by position and carry
`product_id` forward, but that's out of scope here.

## Error handling

Same pattern as create: each Supabase call's `error` is checked and thrown;
caught in the outer `try/catch`, shown via `toast.error(...,
{description: err.message})`. No partial-state cleanup beyond what create
already does (acceptable — same risk profile as existing create path).

## Testing

- Manual: edit a bill's amount/notes/line items/GST fields, save, verify
  `SupplierTransactionsTab` and `SupplierLedgerDialog` reflect changes.
- Manual: edit a payment/advance row (amount, date, payment_mode, notes).
- Manual: replace bill image on an existing bill, verify old storage path is
  overwritten and `supplier_bills.image_url` still resolves.
- Manual: edit a bill with linked line-item products, confirm limitation
  behaves as documented (links dropped, no crash).
- Unit test (if added): `formatINR` preview renders expected string for a
  few representative values (covered already by existing `formatCurrency`
  usage elsewhere — no new util introduced).
- Manual: enter the sample bill (5 saree line items, 10% disc each, IGST
  5%, round off -0.16) and confirm computed line amounts, taxable amount
  (24,543.00), and final total (25,770.00) match.
- Manual: edit an existing bill's `discount_pct` on a line and confirm line
  amount, taxable amount, and final total all recompute live.
