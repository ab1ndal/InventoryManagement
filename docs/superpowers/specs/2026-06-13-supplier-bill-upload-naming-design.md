# Supplier Bill Upload: PDF Support + Logical Filenames

## Problem

`SupplierTransactionDialog.js` already lets users attach a bill document when
recording a "bill" transaction. Today:
- Only images are accepted (`accept="image/*"`)
- Uploaded with path `${supplierid}/${transaction_id}-${Date.now()}-${file.name}`
  — opaque, hard to locate in Supabase Storage browser

Goal: accept PDFs too, and store under a human-readable name:
`<ddMMyy>_<SupplierName>_<InvoiceNumber>.<ext>`

## Filename Convention

```
<ddMMyy>_<SanitizedSupplierName>_<InvoiceNumberOrTxnId>.<ext>
```

- **Date**: `transaction_date` from the form (the invoice's date), formatted `ddMMyy`
- **Supplier name**: alphanumeric chars only, spaces/punctuation stripped
  (e.g. "Acme Textiles & Co." → "AcmeTextilesCo")
- **Invoice number**: used as-is if present; falls back to `transaction_id`
  if the invoice number field is blank (keeps name unique even without an
  invoice #)
- **Extension**: taken from the uploaded file's name, lowercased

Example: `130626_AcmeTextiles_INV-0042.pdf`

## Storage Path & Collisions

Path stays `${supplierid}/${filename}` (per-supplier folder, unchanged).
Upload uses `{ upsert: true }` — re-uploading a bill for the same
invoice/date/supplier overwrites the previous file rather than erroring or
creating a duplicate.

## Changes

### 1. New util: `src/utility/billFilename.js`
```js
export function buildBillFilename({ date, supplierName, invoiceNumber, transactionId, ext })
```
Returns the formatted filename string. Pure function, unit tested in
`src/utility/__tests__/billFilename.test.js`.

### 2. `src/admin/components/SupplierTransactionDialog.js`
- File input: `accept="image/*,application/pdf"`, label "Bill Document (image or PDF)"
- On submit (bill type + file present): build filename via `buildBillFilename`,
  set `storagePath = ${selectedSupplier.supplierid}/${filename}`,
  upload with `{ upsert: true }`

### 3. `src/admin/components/SupplierLedgerDialog.js`
- Link text "View Bill Image ↗" → "View Bill ↗" (file may now be a PDF)

## No DB/schema changes
`supplier_bills.image_url` / `storage_path` columns are already generic
strings — no migration needed.

## Testing
- Unit test `buildBillFilename` covering: normal case, missing invoice number
  (falls back to transaction_id), supplier name with spaces/special chars,
  PDF vs image extension.
- Manual: upload a PDF and an image bill via the dialog, confirm filename in
  Supabase Storage matches convention, confirm "View Bill ↗" link opens both
  file types, confirm re-upload overwrites (upsert).
