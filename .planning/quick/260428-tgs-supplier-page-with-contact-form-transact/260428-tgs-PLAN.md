---
phase: 260428-tgs
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - schema/migration_supplier_transactions.sql
  - schema/migration_supplier_bills.sql
  - src/admin/pages/SuppliersPage.js
  - src/admin/components/SupplierForm.js
  - src/admin/components/SupplierTable.js
  - src/admin/components/SupplierTransactionDialog.js
  - src/admin/components/SupplierLedgerDialog.js
  - src/admin/components/SupplierBillUpload.js
autonomous: false
requirements:
  - SUP-01-form
  - SUP-02-table
  - SUP-03-edit
  - SUP-04-add-transaction
  - SUP-05-ledger
  - SUP-06-payments
  - SUP-07-bill-images
  - SUP-08-formatting

must_haves:
  truths:
    - User can add new supplier with name, phone, email, notes (existing table fields only)
    - User can view all suppliers in a table on /admin/suppliers
    - User can edit existing supplier details via modal
    - User can record a bill received from supplier (debit) with date and ₹ amount
    - User can record a payment made to supplier (credit) with date and ₹ amount
    - User can view supplier ledger showing bills, payments, and running balance
    - User can optionally upload a bill image when recording a bill
    - User can view uploaded bill images in-app
    - All currency displayed with ₹ prefix
    - All dates displayed as DD/MM/YYYY
  artifacts:
    - path: schema/migration_supplier_transactions.sql
      provides: CREATE TABLE supplier_transactions
    - path: schema/migration_supplier_bills.sql
      provides: CREATE TABLE supplier_bills + storage bucket setup notes
    - path: src/admin/pages/SuppliersPage.js
      provides: page composition — table + form + ledger
    - path: src/admin/components/SupplierForm.js
      provides: add/edit supplier dialog with zod validation
    - path: src/admin/components/SupplierTable.js
      provides: supplier list with edit + add transaction + view ledger actions
    - path: src/admin/components/SupplierTransactionDialog.js
      provides: dialog to record bill or payment with optional image upload
    - path: src/admin/components/SupplierLedgerDialog.js
      provides: balance-sheet style ledger with running balance
  key_links:
    - from: src/admin/pages/SuppliersPage.js
      to: src/admin/components/SupplierTable.js
      via: refreshFlag pattern
      pattern: refreshSignal
    - from: src/admin/components/SupplierTransactionDialog.js
      to: supabase.storage bucket 'supplier-bills'
      via: supabase.storage.from('supplier-bills').upload
      pattern: storage\.from\('supplier-bills'\)
    - from: src/admin/components/SupplierLedgerDialog.js
      to: supplier_transactions + supplier_bills tables
      via: supabase select with join
      pattern: from\('supplier_transactions'\)
---

<objective>
Build supplier management page with contact CRUD, transaction tracking (bills + payments), running balance ledger, and bill image uploads.

Purpose: Enable user to track supplier accounts (what they owe vs what they've paid) with paper trail of bill images.
Output: Functional `/admin/suppliers` page replacing current placeholder, plus 3 SQL migrations and 5 new components.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@CLAUDE.md
@src/admin/pages/SuppliersPage.js
@src/admin/pages/CustomersPage.js
@src/admin/components/CustomerForm.js
@src/admin/components/CustomerTable.js
@src/utility/dateFormat.js
@src/utility/formatPhone.js
@schema/suppliers.sql

<interfaces>
Existing suppliers table:
```sql
suppliers (
  supplierid serial PK,
  name varchar(100) NOT NULL,
  phone varchar(20),
  email varchar(100),
  notes text
)
```

Existing patterns in codebase:
- Page composition: src/admin/pages/CustomersPage.js (form + table + refreshSignal toggle)
- Form: src/admin/components/CustomerForm.js (react-hook-form + zod + Dialog + supabase)
- Date formatting: `import { formatDate } from "../../utility/dateFormat"` — converts ISO/date to DD/MM/YYYY
- Phone formatting: `formatLivePhoneInput` from `../../utility/formatPhone`
- Toasts: `import { toast } from "sonner"`
- Supabase: `import { supabase } from "../../lib/supabaseClient"`

UI primitives in src/components/ui/: Dialog, Input, Button, Table, Form, Select, Textarea, Tabs, Card, Label.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Schema migrations — create transactions/bills tables</name>
  <files>
    schema/migration_supplier_transactions.sql,
    schema/migration_supplier_bills.sql
  </files>
  <action>
Create two migration SQL files (per project rule: schema changes go in separate migration files). Use existing suppliers table as-is (name, phone, email, notes only — no new columns yet).

1. `schema/migration_supplier_transactions.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
  transaction_id serial PRIMARY KEY,
  supplier_id integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bill','payment')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier
  ON public.supplier_transactions(supplier_id, transaction_date);
```

3. `schema/migration_supplier_bills.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.supplier_bills (
  bill_id serial PRIMARY KEY,
  transaction_id integer REFERENCES public.supplier_transactions(transaction_id) ON DELETE SET NULL,
  supplier_id integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  image_url text NOT NULL,
  storage_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier
  ON public.supplier_bills(supplier_id);

-- MANUAL STEP (Supabase dashboard):
-- 1. Storage > New bucket > name: 'supplier-bills', public: true
-- 2. Bucket policies: allow authenticated insert + select
```

Add file headers as comments. Do NOT run migrations — user runs in Supabase dashboard.
  </action>
  <verify>
    <automated>test -f schema/migration_supplier_extra_fields.sql && test -f schema/migration_supplier_transactions.sql && test -f schema/migration_supplier_bills.sql && echo OK</automated>
  </verify>
  <done>Three migration files exist with valid SQL, including FK constraints, type CHECK, and storage bucket setup note.</done>
</task>

<task type="auto">
  <name>Task 2: SupplierForm component (add/edit dialog)</name>
  <files>src/admin/components/SupplierForm.js</files>
  <action>
Create dialog form component modeled on CustomerForm.js but simpler.

Schema (zod) — existing table fields only:
- name: required, min 1
- phone: optional, formatted via formatLivePhoneInput
- email: optional, valid email or empty
- notes: optional textarea

Props: `defaultValues` (existing supplier or null), `onSubmit` callback, `openExternally`, `setOpenExternally`, `triggerLabel`.

On submit:
- If `defaultValues?.supplierid`: `supabase.from('suppliers').update({...}).eq('supplierid', id)`
- Else: `supabase.from('suppliers').insert({...})`
- Toast success/error via sonner
- Call `onSubmit()` on success

Use Dialog, Form, FormField, FormItem, FormLabel, FormControl, FormMessage from ui primitives. Input for name/phone/email/gst, Textarea for address/notes.
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>Component compiles. Add/edit submits row to suppliers table with new fields. Validation messages render.</done>
</task>

<task type="auto">
  <name>Task 3: SupplierTable component</name>
  <files>src/admin/components/SupplierTable.js</files>
  <action>
Create table component listing all suppliers.

Fetch on mount + when `refreshSignal` prop changes:
```js
supabase.from('suppliers').select('*').order('name')
```

Also fetch aggregated balance per supplier:
```js
supabase.from('supplier_transactions').select('supplier_id, type, amount')
```
Compute `balance = sum(bills) - sum(payments)` per supplier client-side.

Columns: Name, Phone, Email, Balance (₹, color red if >0 i.e. owed), Actions.

Actions per row (use Button variants):
- Edit → calls `onEditSupplier(supplier)` prop
- Add Transaction → calls `onAddTransaction(supplier)` prop
- View Ledger → calls `onViewLedger(supplier)` prop

Display:
- Phone via existing formatPhone if formatter exists
- Balance: `₹{balance.toFixed(2)}` — red text if balance > 0 (we owe), green if < 0 (overpaid), gray if 0
- Empty state: "No suppliers yet"

Use Table primitive from `../../components/ui/table`.
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>Table renders all suppliers with computed balance. Action buttons fire prop callbacks.</done>
</task>

<task type="auto">
  <name>Task 4: SupplierTransactionDialog (record bill or payment + optional image)</name>
  <files>src/admin/components/SupplierTransactionDialog.js</files>
  <action>
Create dialog for recording a supplier_transactions row.

Props: `supplier` (object with supplierid + name), `open`, `onOpenChange`, `onSuccess`.

Fields (react-hook-form + zod):
- type: radio/select 'bill' | 'payment' (default 'bill')
- amount: number > 0, ₹ prefix in label
- transaction_date: date input, default today, displayed as DD/MM/YYYY (use type="date" but format display)
- notes: optional textarea
- bill_image: optional file input (only shown when type === 'bill'), accept="image/*"

Submit flow:
1. Insert into `supplier_transactions` returning `transaction_id`.
2. If `bill_image` present AND type==='bill':
   - Path: `${supplier.supplierid}/${transaction_id}-${Date.now()}-${file.name}`
   - `supabase.storage.from('supplier-bills').upload(path, file)`
   - Get public URL: `supabase.storage.from('supplier-bills').getPublicUrl(path)`
   - Insert into `supplier_bills` with `transaction_id`, `supplier_id`, `image_url`, `storage_path`.
3. Toast "Bill recorded" / "Payment recorded".
4. Call `onSuccess()`, close dialog.

On any failure: toast error, do not close.

Title: "Add Transaction — {supplier.name}".
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>Dialog inserts transaction row. When type=bill with image, uploads to storage + inserts supplier_bills row linked by transaction_id.</done>
</task>

<task type="auto">
  <name>Task 5: SupplierLedgerDialog (balance sheet view)</name>
  <files>src/admin/components/SupplierLedgerDialog.js</files>
  <action>
Create read-only ledger dialog showing transaction history for one supplier.

Props: `supplier`, `open`, `onOpenChange`.

On open, fetch:
```js
const { data: txns } = await supabase
  .from('supplier_transactions')
  .select('*')
  .eq('supplier_id', supplier.supplierid)
  .order('transaction_date', { ascending: true })
  .order('transaction_id', { ascending: true });

const { data: bills } = await supabase
  .from('supplier_bills')
  .select('transaction_id, image_url')
  .eq('supplier_id', supplier.supplierid);
```

Build `billsByTxn = Object.fromEntries(bills.map(b => [b.transaction_id, b.image_url]))`.

Compute running balance:
- Iterate txns in order. `running += (type==='bill' ? amount : -amount)`.

Render Table with columns: Date (DD/MM/YYYY via formatDate), Type (Bill/Payment badge), Notes, Debit (₹ if bill), Credit (₹ if payment), Balance (₹ running, red if positive), Image (link "View" if bill image exists, opens image_url in new tab).

Footer row: "Current Balance: ₹{final}" — bold, red if positive, green if negative.

Title: "Ledger — {supplier.name}".

Use ScrollArea wrapper if rows > 20.
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -5</automated>
  </verify>
  <done>Ledger renders chronological transactions with running balance. Bill images viewable via link. Dates in DD/MM/YYYY, amounts with ₹.</done>
</task>

<task type="auto">
  <name>Task 6: SuppliersPage composition</name>
  <files>src/admin/pages/SuppliersPage.js</files>
  <action>
Replace placeholder with composition modeled on CustomersPage.js.

State:
- `formOpen`, `editingSupplier`
- `txnDialogOpen`, `txnSupplier`
- `ledgerDialogOpen`, `ledgerSupplier`
- `refreshSignal` (number, increment to refetch table)

Layout:
```jsx
<div className="space-y-6">
  <div className="flex items-center justify-between">
    <h2 className="text-2xl font-semibold">Supplier Management</h2>
    <Button onClick={() => { setEditingSupplier(null); setFormOpen(true); }}>
      Add Supplier
    </Button>
  </div>

  <SupplierTable
    refreshSignal={refreshSignal}
    onEditSupplier={(s) => { setEditingSupplier(s); setFormOpen(true); }}
    onAddTransaction={(s) => { setTxnSupplier(s); setTxnDialogOpen(true); }}
    onViewLedger={(s) => { setLedgerSupplier(s); setLedgerDialogOpen(true); }}
  />

  {formOpen && (
    <SupplierForm
      defaultValues={editingSupplier}
      onSubmit={() => { setFormOpen(false); setEditingSupplier(null); setRefreshSignal(p=>p+1); }}
      openExternally={formOpen}
      setOpenExternally={setFormOpen}
      triggerLabel={editingSupplier ? "Edit Supplier" : "Add Supplier"}
    />
  )}

  {txnSupplier && (
    <SupplierTransactionDialog
      supplier={txnSupplier}
      open={txnDialogOpen}
      onOpenChange={setTxnDialogOpen}
      onSuccess={() => { setTxnDialogOpen(false); setRefreshSignal(p=>p+1); }}
    />
  )}

  {ledgerSupplier && (
    <SupplierLedgerDialog
      supplier={ledgerSupplier}
      open={ledgerDialogOpen}
      onOpenChange={setLedgerDialogOpen}
    />
  )}
</div>
```

Imports at top. No route change needed — `/admin/suppliers` already maps to this file.
  </action>
  <verify>
    <automated>npm run build 2>&1 | tail -10</automated>
  </verify>
  <done>Page builds. All four components wire together. Refresh signal triggers table refetch after add/edit/transaction.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 7: Manual verification — apply migrations + smoke test</name>
  <what-built>
    Three SQL migration files, five components (SupplierForm, SupplierTable, SupplierTransactionDialog, SupplierLedgerDialog), updated SuppliersPage. All currency in ₹, all dates DD/MM/YYYY.
  </what-built>
  <how-to-verify>
    1. Apply migrations in Supabase dashboard (SQL editor):
       - Run schema/migration_supplier_extra_fields.sql
       - Run schema/migration_supplier_transactions.sql
       - Run schema/migration_supplier_bills.sql
    2. Create Supabase Storage bucket 'supplier-bills' (public). Add policies: authenticated INSERT + SELECT.
    3. `npm start`, navigate to /admin/suppliers.
    4. Click "Add Supplier" → fill name, phone, email, notes → Save. Confirm row appears in table.
    5. Click "Edit" on supplier → change something → Save. Confirm update.
    6. Click "Add Transaction" → type=Bill, amount=1000, date=today, notes=test, upload an image → Save. Confirm balance now ₹1000 (red).
    7. Click "Add Transaction" → type=Payment, amount=400 → Save. Confirm balance ₹600.
    8. Click "View Ledger" → confirm two rows in chronological order, debit/credit columns correct, running balance 1000 then 600. Click "View" on bill row → image opens.
    9. Confirm all dates render as DD/MM/YYYY and all amounts have ₹ prefix.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues</resume-signal>
</task>

</tasks>

<verification>
- All 6 build tasks compile without errors (`npm run build` clean)
- Migrations apply cleanly in Supabase
- Smoke test in Task 7 passes all 9 steps
</verification>

<success_criteria>
- /admin/suppliers shows full supplier management UI
- User can CRUD suppliers, add bills + payments, view balance ledger, attach bill images
- Running balance computed correctly (sum bills - sum payments)
- All currency: ₹, all dates: DD/MM/YYYY
- Bill images stored in Supabase Storage 'supplier-bills' bucket, viewable via public URL
</success_criteria>

<output>
After completion, create `.planning/quick/260428-tgs-supplier-page-with-contact-form-transact/260428-tgs-SUMMARY.md`
</output>
