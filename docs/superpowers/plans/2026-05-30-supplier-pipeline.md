# Supplier Pipeline Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the supplier module with richer profiles (GSTIN, PAN, address, opening balance), GST-compliant bill capture, advance transaction type, payment mode tracking, a two-subtab page layout (Suppliers | Transactions), and drill-down ledger rows.

**Architecture:** The existing `supplier_transactions` table is extended with new columns; no data migration needed. A new `supplierBalance.js` utility centralises balance computation so both the ledger dialog and transactions tab share one source of truth. `SuppliersPage` gains a two-tab layout rendered with Shadcn `Tabs` — Tab 1 is the existing supplier management UI, Tab 2 is a new `SupplierTransactionsTab` component.

**Tech Stack:** React 19, Supabase (PostgreSQL), React Hook Form + Zod, Shadcn/ui (Tabs, Dialog, Badge), Sonner toasts, Vitest (existing test runner).

---

## File Map

| Action | File |
|--------|------|
| Create | `schema/migration_supplier_pipeline.sql` |
| Create | `src/utility/supplierBalance.js` |
| Create | `src/utility/__tests__/supplierBalance.test.js` |
| Modify | `src/admin/components/SupplierForm.js` |
| Modify | `src/admin/components/SupplierTransactionDialog.js` |
| Modify | `src/admin/components/SupplierLedgerDialog.js` |
| Create | `src/admin/components/SupplierTransactionsTab.js` |
| Modify | `src/admin/pages/SuppliersPage.js` |

---

## Task 1: DB Migration

**Files:**
- Create: `schema/migration_supplier_pipeline.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration: Supplier pipeline enhancement
-- Run in Supabase dashboard SQL editor

-- 1. Extend suppliers table
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gstin      varchar(15),
  ADD COLUMN IF NOT EXISTS pan        varchar(10),
  ADD COLUMN IF NOT EXISTS address    text,
  ADD COLUMN IF NOT EXISTS opening_balance numeric(12,2) NOT NULL DEFAULT 0;

-- 2. Extend supplier_transactions: drop old check, re-add with 'advance'
ALTER TABLE public.supplier_transactions
  DROP CONSTRAINT IF EXISTS supplier_transactions_type_check;

ALTER TABLE public.supplier_transactions
  ADD CONSTRAINT supplier_transactions_type_check
  CHECK (type IN ('bill', 'payment', 'advance'));

-- 3. Add new columns to supplier_transactions
ALTER TABLE public.supplier_transactions
  ADD COLUMN IF NOT EXISTS invoice_number  varchar(50),
  ADD COLUMN IF NOT EXISTS taxable_amount  numeric(12,2),
  ADD COLUMN IF NOT EXISTS cgst_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS sgst_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS igst_amount     numeric(12,2),
  ADD COLUMN IF NOT EXISTS payment_mode    varchar(20);

-- payment_mode values: cash, upi, bank, cheque (enforced in app, not DB)
```

- [ ] **Step 2: Run in Supabase SQL editor and confirm no errors**

- [ ] **Step 3: Commit**

```bash
git add schema/migration_supplier_pipeline.sql
git commit -m "feat: supplier pipeline — DB migration"
```

---

## Task 2: Balance Utility (TDD)

**Files:**
- Create: `src/utility/supplierBalance.js`
- Create: `src/utility/__tests__/supplierBalance.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/utility/__tests__/supplierBalance.test.js
import { computeRunningLedger, computeSummary } from "../supplierBalance";

describe("computeRunningLedger", () => {
  it("starts with opening balance", () => {
    const rows = computeRunningLedger([], 500);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("opening");
    expect(rows[0].running).toBe(500);
  });

  it("bills add to balance", () => {
    const txns = [{ transaction_id: 1, type: "bill", amount: "1000", transaction_date: "2026-01-01", notes: null }];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[1].running).toBe(1000);
  });

  it("payments reduce balance", () => {
    const txns = [
      { transaction_id: 1, type: "bill",    amount: "1000", transaction_date: "2026-01-01", notes: null },
      { transaction_id: 2, type: "payment", amount: "400",  transaction_date: "2026-01-02", notes: null },
    ];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[2].running).toBe(600);
  });

  it("advances reduce balance", () => {
    const txns = [
      { transaction_id: 1, type: "advance", amount: "200", transaction_date: "2026-01-01", notes: null },
    ];
    const rows = computeRunningLedger(txns, 0);
    expect(rows[1].running).toBe(-200);
  });

  it("negative opening balance (supplier owes us)", () => {
    const rows = computeRunningLedger([], -300);
    expect(rows[0].running).toBe(-300);
  });
});

describe("computeSummary", () => {
  it("returns totals from ledger rows", () => {
    const txns = [
      { transaction_id: 1, type: "bill",    amount: "2000", transaction_date: "2026-01-01", notes: null },
      { transaction_id: 2, type: "payment", amount: "800",  transaction_date: "2026-01-02", notes: null },
      { transaction_id: 3, type: "advance", amount: "300",  transaction_date: "2026-01-03", notes: null },
    ];
    const s = computeSummary(txns, 0);
    expect(s.totalBilled).toBe(2000);
    expect(s.totalPaid).toBe(1100);   // 800 + 300
    expect(s.netBalance).toBe(900);   // 0 + 2000 - 800 - 300
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npm test -- --testPathPattern=supplierBalance
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement utility**

```js
// src/utility/supplierBalance.js

/**
 * Returns ledger rows with running balance.
 * First row is always the opening balance sentinel.
 * @param {Array} txns - rows from supplier_transactions ordered by date asc
 * @param {number} openingBalance - from suppliers.opening_balance
 */
export function computeRunningLedger(txns, openingBalance) {
  const rows = [];
  let running = Number(openingBalance) || 0;

  rows.push({ type: "opening", running, transaction_id: "opening" });

  for (const t of txns) {
    const amt = Number(t.amount);
    running += t.type === "bill" ? amt : -amt;
    rows.push({ ...t, running });
  }

  return rows;
}

/**
 * Summarises transactions into totals.
 */
export function computeSummary(txns, openingBalance) {
  let totalBilled = 0;
  let totalPaid = 0;

  for (const t of txns) {
    const amt = Number(t.amount);
    if (t.type === "bill") totalBilled += amt;
    else totalPaid += amt; // payment + advance
  }

  const netBalance = Number(openingBalance) + totalBilled - totalPaid;
  return { totalBilled, totalPaid, netBalance };
}
```

- [ ] **Step 4: Run to confirm PASS**

```bash
npm test -- --testPathPattern=supplierBalance
```
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/utility/supplierBalance.js src/utility/__tests__/supplierBalance.test.js
git commit -m "feat: supplier balance utility with tests"
```

---

## Task 3: SupplierForm — Profile Fields

**Files:**
- Modify: `src/admin/components/SupplierForm.js`

- [ ] **Step 1: Update Zod schema** — add gstin, pan, address, opening_balance

Replace the `formSchema` const (lines 28–43) with:

```js
const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v?.replace(/\s/g, "") ?? null)),
  email: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v))
    .refine(
      (v) => v === null || v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "Invalid email"
    ),
  notes: z.string().optional().transform((v) => (v?.trim() === "" ? null : v)),
  gstin: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v?.toUpperCase() ?? null))
    .refine(
      (v) => v === null || v === undefined || /^[0-9A-Z]{15}$/.test(v),
      "GSTIN must be 15 alphanumeric characters"
    ),
  pan: z
    .string()
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v?.toUpperCase() ?? null))
    .refine(
      (v) => v === null || v === undefined || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v),
      "Invalid PAN format (e.g. ABCDE1234F)"
    ),
  address: z.string().optional().transform((v) => (v?.trim() === "" ? null : v)),
  opening_balance: z.coerce
    .number({ invalid_type_error: "Must be a number" })
    .default(0),
});
```

- [ ] **Step 2: Update form defaultValues and reset**

In `useForm` defaultValues (and the `form.reset` in useEffect), add:

```js
gstin: defaultValues?.gstin ?? "",
pan: defaultValues?.pan ?? "",
address: defaultValues?.address ?? "",
opening_balance: defaultValues?.opening_balance ?? 0,
```

- [ ] **Step 3: Update Supabase payload in handleSubmit**

In the `payload` object inside `handleSubmit`, add:

```js
gstin: values.gstin ?? null,
pan: values.pan ?? null,
address: values.address ?? null,
opening_balance: values.opening_balance,
```

- [ ] **Step 4: Add form fields to JSX**

After the existing email/phone grid and before the Notes field, add:

```jsx
<div className="grid grid-cols-2 gap-4">
  <FormField
    name="gstin"
    control={form.control}
    render={({ field }) => (
      <FormItem>
        <FormLabel>GSTIN</FormLabel>
        <FormControl>
          <Input {...field} placeholder="09ABCDE1234F1Z5" className="uppercase" />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
  <FormField
    name="pan"
    control={form.control}
    render={({ field }) => (
      <FormItem>
        <FormLabel>PAN</FormLabel>
        <FormControl>
          <Input {...field} placeholder="ABCDE1234F" className="uppercase" />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
</div>

<FormField
  name="address"
  control={form.control}
  render={({ field }) => (
    <FormItem>
      <FormLabel>Address</FormLabel>
      <FormControl>
        <Textarea {...field} rows={2} placeholder="Supplier address…" />
      </FormControl>
      <FormMessage />
    </FormItem>
  )}
/>

<FormField
  name="opening_balance"
  control={form.control}
  render={({ field }) => (
    <FormItem>
      <FormLabel>Opening Balance (₹)</FormLabel>
      <FormControl>
        <Input {...field} type="number" step="0.01" placeholder="0.00" />
      </FormControl>
      <p className="text-xs text-muted-foreground">
        Positive = we owe them. Negative = they owe us.
      </p>
      <FormMessage />
    </FormItem>
  )}
/>
```

- [ ] **Step 5: Manual verify** — open Add Supplier dialog, confirm new fields render and save correctly to Supabase

- [ ] **Step 6: Commit**

```bash
git add src/admin/components/SupplierForm.js
git commit -m "feat: supplier form — GSTIN, PAN, address, opening balance"
```

---

## Task 4: SupplierTransactionDialog — Advance Type + GST Fields + Payment Mode

**Files:**
- Modify: `src/admin/components/SupplierTransactionDialog.js`

- [ ] **Step 1: Update Zod schema**

Replace `formSchema` with:

```js
const formSchema = z.object({
  type: z.enum(["bill", "payment", "advance"]),
  amount: z.coerce
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0"),
  transaction_date: z.string().min(1, "Date is required"),
  notes: z.string().optional().transform((v) => (v?.trim() === "" ? undefined : v)),
  // Bill-only fields
  invoice_number: z.string().optional().transform((v) => (v?.trim() === "" ? null : v)),
  taxable_amount: z.coerce.number().nonnegative().optional().nullable(),
  cgst_amount: z.coerce.number().nonnegative().optional().nullable(),
  sgst_amount: z.coerce.number().nonnegative().optional().nullable(),
  igst_amount: z.coerce.number().nonnegative().optional().nullable(),
  // Payment/advance-only
  payment_mode: z.enum(["cash", "upi", "bank", "cheque"]).optional().nullable(),
  bill_image: z.any().optional(),
});
```

- [ ] **Step 2: Update defaultValues and reset**

```js
defaultValues: {
  type: "bill",
  amount: "",
  transaction_date: today,
  notes: "",
  invoice_number: "",
  taxable_amount: "",
  cgst_amount: "",
  sgst_amount: "",
  igst_amount: "",
  payment_mode: null,
  bill_image: null,
},
```

- [ ] **Step 3: Update handleSubmit to send new fields**

In the `supabase.from("supplier_transactions").insert(...)` call, extend the payload:

```js
const isBill = values.type === "bill";
const isPaymentOrAdvance = values.type === "payment" || values.type === "advance";

const { data: txnData, error: txnError } = await supabase
  .from("supplier_transactions")
  .insert({
    supplier_id: supplier.supplierid,
    type: values.type,
    amount: values.amount,
    transaction_date: values.transaction_date,
    notes: values.notes ?? null,
    invoice_number: isBill ? (values.invoice_number ?? null) : null,
    taxable_amount: isBill ? (values.taxable_amount || null) : null,
    cgst_amount: isBill ? (values.cgst_amount || null) : null,
    sgst_amount: isBill ? (values.sgst_amount || null) : null,
    igst_amount: isBill ? (values.igst_amount || null) : null,
    payment_mode: isPaymentOrAdvance ? (values.payment_mode ?? null) : null,
  })
  .select("transaction_id")
  .single();
```

- [ ] **Step 4: Update type selector JSX** — add advance option

```jsx
<select {...field} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary">
  <option value="bill">Bill (debit — we owe)</option>
  <option value="payment">Payment (credit — we paid)</option>
  <option value="advance">Advance (credit — pre-payment)</option>
</select>
```

- [ ] **Step 5: Add bill-specific GST fields JSX**

After the existing Amount field and before Notes, add (only shown when `txnType === "bill"`):

```jsx
{txnType === "bill" && (
  <>
    <FormField
      name="invoice_number"
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Invoice Number</FormLabel>
          <FormControl>
            <Input {...field} placeholder="e.g. 033/26-27" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    <div className="border rounded-md p-3 space-y-3 bg-gray-50">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">GST Breakdown (optional)</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          name="taxable_amount"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Taxable (₹)</FormLabel>
              <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="cgst_amount"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>CGST (₹)</FormLabel>
              <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="sgst_amount"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>SGST (₹)</FormLabel>
              <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="igst_amount"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>IGST (₹)</FormLabel>
              <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  </>
)}
```

- [ ] **Step 6: Add payment mode field** — shown when type is payment or advance

```jsx
{(txnType === "payment" || txnType === "advance") && (
  <FormField
    name="payment_mode"
    control={form.control}
    render={({ field }) => (
      <FormItem>
        <FormLabel>Payment Mode</FormLabel>
        <FormControl>
          <select
            {...field}
            value={field.value ?? ""}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select mode…</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
)}
```

- [ ] **Step 7: Update toast success message** — add advance case

```js
toast.success(
  values.type === "bill" ? "Bill recorded"
  : values.type === "advance" ? "Advance recorded"
  : "Payment recorded"
);
```

- [ ] **Step 8: Manual verify** — record a bill with invoice number + GST fields; record a payment with mode; record an advance. Confirm all save in DB.

- [ ] **Step 9: Commit**

```bash
git add src/admin/components/SupplierTransactionDialog.js
git commit -m "feat: transaction dialog — advance type, GST fields, payment mode"
```

---

## Task 5: SupplierLedgerDialog — Opening Balance + Drill-Down Rows

**Files:**
- Modify: `src/admin/components/SupplierLedgerDialog.js`

- [ ] **Step 1: Import the balance utility and add row expansion state**

At top of file, add:

```js
import { computeRunningLedger, computeSummary } from "../../utility/supplierBalance";
```

Inside component, add state:

```js
const [expandedRow, setExpandedRow] = useState(null); // transaction_id or "opening"
```

- [ ] **Step 2: Update fetchLedger to fetch opening_balance and new transaction columns**

Replace `fetchLedger` with:

```js
const fetchLedger = async () => {
  setLoading(true);

  const [{ data: supplierData }, { data: txns, error: txnErr }, { data: bills }] =
    await Promise.all([
      supabase
        .from("suppliers")
        .select("opening_balance")
        .eq("supplierid", supplier.supplierid)
        .single(),
      supabase
        .from("supplier_transactions")
        .select("*")
        .eq("supplier_id", supplier.supplierid)
        .order("transaction_date", { ascending: true })
        .order("transaction_id", { ascending: true }),
      supabase
        .from("supplier_bills")
        .select("transaction_id, image_url")
        .eq("supplier_id", supplier.supplierid),
    ]);

  if (txnErr) {
    console.error("Error fetching transactions:", txnErr.message);
    setLoading(false);
    return;
  }

  const billsByTxn = Object.fromEntries(
    (bills || []).map((b) => [b.transaction_id, b.image_url])
  );

  const openingBalance = Number(supplierData?.opening_balance) || 0;
  const computed = computeRunningLedger(txns || [], openingBalance).map((row) => ({
    ...row,
    imageUrl: row.transaction_id !== "opening" ? (billsByTxn[row.transaction_id] ?? null) : null,
  }));

  setRows(computed);
  setLoading(false);
};
```

- [ ] **Step 3: Compute summary for header bar**

Replace `const finalBalance = ...` with:

```js
const txnRows = rows.filter((r) => r.transaction_id !== "opening");
const openingBalance = rows.length > 0 ? rows[0].running - (txnRows[0] ? (txnRows[0].running - rows[0].running) : 0) : 0;
// Simpler: read it from supplier query — store it in state
```

Actually, store opening balance separately. Add state:

```js
const [openingBalance, setOpeningBalance] = useState(0);
```

Set it inside fetchLedger after computing:

```js
setOpeningBalance(Number(supplierData?.opening_balance) || 0);
```

Then compute summary:

```js
const summary = computeSummary(
  txnRows,
  openingBalance
);
```

- [ ] **Step 4: Replace ledger table JSX**

Replace the `<table>` block with:

```jsx
<ScrollArea className={rows.length > 20 ? "h-[480px]" : undefined}>
  <table className="min-w-full text-sm">
    <thead className="bg-gray-100 sticky top-0">
      <tr>
        <th className="p-2 text-left font-semibold">Date</th>
        <th className="p-2 text-left font-semibold">Type</th>
        <th className="p-2 text-left font-semibold">Invoice</th>
        <th className="p-2 text-right font-semibold">Debit (Bill)</th>
        <th className="p-2 text-right font-semibold">Credit (Paid)</th>
        <th className="p-2 text-right font-semibold">Balance</th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <React.Fragment key={row.transaction_id}>
          <tr
            className={`border-t hover:bg-gray-50 cursor-pointer ${expandedRow === row.transaction_id ? "bg-blue-50" : ""}`}
            onClick={() => setExpandedRow(expandedRow === row.transaction_id ? null : row.transaction_id)}
          >
            <td className="p-2 whitespace-nowrap text-muted-foreground text-xs">
              {row.type === "opening" ? "—" : formatDate(row.transaction_date)}
            </td>
            <td className="p-2">
              {row.type === "opening" ? (
                <span className="text-xs text-muted-foreground italic">Opening Balance</span>
              ) : (
                <Badge
                  variant="outline"
                  className={
                    row.type === "bill"
                      ? "bg-red-100 text-red-700 border-none"
                      : row.type === "advance"
                      ? "bg-yellow-100 text-yellow-700 border-none"
                      : "bg-green-100 text-green-700 border-none"
                  }
                >
                  {row.type === "bill" ? "Bill" : row.type === "advance" ? "Advance" : "Payment"}
                </Badge>
              )}
            </td>
            <td className="p-2 text-xs text-muted-foreground">
              {row.invoice_number || "—"}
            </td>
            <td className="p-2 text-right tabular-nums text-red-600">
              {row.type === "bill" ? formatINR(row.amount, 2) : ""}
            </td>
            <td className="p-2 text-right tabular-nums text-green-600">
              {row.type === "payment" || row.type === "advance" ? formatINR(row.amount, 2) : ""}
            </td>
            <td className={`p-2 text-right tabular-nums ${balanceClass(row.running)}`}>
              {formatINR(row.running, 2)}
            </td>
          </tr>

          {/* Drill-down detail row */}
          {expandedRow === row.transaction_id && row.type !== "opening" && (
            <tr className="bg-blue-50 border-t border-blue-100">
              <td colSpan={6} className="px-4 py-3">
                {row.type === "bill" ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {row.invoice_number && <div><span className="font-medium">Invoice:</span> {row.invoice_number}</div>}
                    {row.taxable_amount && <div><span className="font-medium">Taxable:</span> {formatINR(row.taxable_amount, 2)}</div>}
                    {row.cgst_amount && <div><span className="font-medium">CGST:</span> {formatINR(row.cgst_amount, 2)}</div>}
                    {row.sgst_amount && <div><span className="font-medium">SGST:</span> {formatINR(row.sgst_amount, 2)}</div>}
                    {row.igst_amount && <div><span className="font-medium">IGST:</span> {formatINR(row.igst_amount, 2)}</div>}
                    {row.notes && <div className="col-span-2"><span className="font-medium">Notes:</span> {row.notes}</div>}
                    {row.imageUrl && (
                      <div>
                        <a href={row.imageUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                          View Bill Image ↗
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-6 text-xs">
                    {row.payment_mode && <div><span className="font-medium">Mode:</span> {row.payment_mode}</div>}
                    {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                  </div>
                )}
              </td>
            </tr>
          )}
        </React.Fragment>
      ))}
    </tbody>
  </table>
</ScrollArea>
```

- [ ] **Step 5: Replace footer balance with summary bar**

Replace the footer div with:

```jsx
<div className="border-t pt-3 mt-2 flex justify-between items-center text-sm flex-wrap gap-2">
  <div className="flex gap-6 text-muted-foreground">
    <span>Total Billed: <span className="font-semibold text-red-600">{formatINR(summary.totalBilled, 2)}</span></span>
    <span>Total Paid: <span className="font-semibold text-green-600">{formatINR(summary.totalPaid, 2)}</span></span>
  </div>
  <span className="font-bold">
    Net Balance:{" "}
    <span className={balanceClass(summary.netBalance)}>
      {formatINR(summary.netBalance, 2)}
    </span>
    {summary.netBalance > 0 && <span className="ml-1 text-xs text-red-500 font-normal">(owed)</span>}
    {summary.netBalance < 0 && <span className="ml-1 text-xs text-green-500 font-normal">(credit)</span>}
  </span>
</div>
```

- [ ] **Step 6: Add [Add Bill] [Add Payment] buttons to dialog header area**

The dialog already receives `supplier`. Pass `onAddTransaction` as a prop and call it from buttons:

Update component signature:
```js
export default function SupplierLedgerDialog({ supplier, open, onOpenChange, onAddTransaction }) {
```

Add buttons below `<DialogDescription>`:
```jsx
<div className="flex gap-2 mt-2">
  <Button size="sm" onClick={() => onAddTransaction?.("bill")}>+ Bill</Button>
  <Button size="sm" variant="outline" onClick={() => onAddTransaction?.("payment")}>+ Payment</Button>
  <Button size="sm" variant="outline" onClick={() => onAddTransaction?.("advance")}>+ Advance</Button>
</div>
```

- [ ] **Step 7: Update SuppliersPage to pass onAddTransaction to SupplierLedgerDialog**

In `SuppliersPage.js`, update the `SupplierLedgerDialog` usage:

```jsx
{ledgerSupplier && (
  <SupplierLedgerDialog
    supplier={ledgerSupplier}
    open={ledgerDialogOpen}
    onOpenChange={setLedgerDialogOpen}
    onAddTransaction={(defaultType) => {
      setLedgerDialogOpen(false);
      setTxnSupplier(ledgerSupplier);
      // Pre-set type in dialog — pass via state
      setTxnDefaultType(defaultType);
      setTxnDialogOpen(true);
    }}
  />
)}
```

Add state: `const [txnDefaultType, setTxnDefaultType] = useState("bill");`

Pass to `SupplierTransactionDialog`: add a `defaultType` prop, use it as default in `form.reset`.

In `SupplierTransactionDialog`, accept `defaultType = "bill"` prop and use in reset:
```js
form.reset({ type: defaultType, amount: "", ... });
```

- [ ] **Step 8: Manual verify** — open ledger, confirm opening balance row appears, confirm drill-down expands on click, confirm summary bar shows correct totals

- [ ] **Step 9: Commit**

```bash
git add src/admin/components/SupplierLedgerDialog.js src/admin/components/SupplierTransactionDialog.js src/admin/pages/SuppliersPage.js
git commit -m "feat: ledger — opening balance, advance type, drill-down rows, summary bar"
```

---

## Task 6: SupplierTransactionsTab — All-Supplier Transactions

**Files:**
- Create: `src/admin/components/SupplierTransactionsTab.js`

- [ ] **Step 1: Create component**

```jsx
// src/admin/components/SupplierTransactionsTab.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { formatDate } from "../../utility/dateFormat";
import { formatINR } from "../../utility/formatCurrency";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import SupplierTransactionDialog from "./SupplierTransactionDialog";

export default function SupplierTransactionsTab() {
  const [transactions, setTransactions] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterType, setFilterType] = useState("");
  const [loading, setLoading] = useState(true);
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnSupplier, setTxnSupplier] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    fetchAll();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: supData }, { data: txnData, error }] = await Promise.all([
      supabase.from("suppliers").select("supplierid, name").order("name"),
      supabase
        .from("supplier_transactions")
        .select("*, suppliers(name)")
        .order("transaction_date", { ascending: false })
        .order("transaction_id", { ascending: false }),
    ]);
    if (!error) {
      setSuppliers(supData || []);
      setTransactions(txnData || []);
    }
    setLoading(false);
  };

  const filtered = transactions.filter((t) => {
    if (filterSupplier && String(t.supplier_id) !== filterSupplier) return false;
    if (filterType && t.type !== filterType) return false;
    return true;
  });

  const typeBadgeClass = (type) => {
    if (type === "bill") return "bg-red-100 text-red-700 border-none";
    if (type === "advance") return "bg-yellow-100 text-yellow-700 border-none";
    return "bg-green-100 text-green-700 border-none";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s.supplierid} value={String(s.supplierid)}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Types</option>
            <option value="bill">Bill</option>
            <option value="payment">Payment</option>
            <option value="advance">Advance</option>
          </select>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setTxnSupplier(suppliers.length === 1 ? suppliers[0] : null);
            setTxnDialogOpen(true);
          }}
        >
          + Add Transaction
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="overflow-auto border rounded-md">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">Supplier</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Invoice No</th>
                <th className="p-3 font-semibold text-right">Debit</th>
                <th className="p-3 font-semibold text-right">Credit</th>
                <th className="p-3 font-semibold">Mode</th>
                <th className="p-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-400">No transactions found</td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.transaction_id} className="border-t hover:bg-gray-50">
                    <td className="p-3 whitespace-nowrap">{formatDate(t.transaction_date)}</td>
                    <td className="p-3 font-medium">{t.suppliers?.name ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={typeBadgeClass(t.type)}>
                        {t.type === "bill" ? "Bill" : t.type === "advance" ? "Advance" : "Payment"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{t.invoice_number || "—"}</td>
                    <td className="p-3 text-right tabular-nums text-red-600">
                      {t.type === "bill" ? formatINR(t.amount, 2) : ""}
                    </td>
                    <td className="p-3 text-right tabular-nums text-green-600">
                      {t.type !== "bill" ? formatINR(t.amount, 2) : ""}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground capitalize">{t.payment_mode || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[160px] truncate">{t.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {txnDialogOpen && txnSupplier && (
        <SupplierTransactionDialog
          supplier={txnSupplier}
          open={txnDialogOpen}
          onOpenChange={setTxnDialogOpen}
          onSuccess={() => {
            setTxnDialogOpen(false);
            setRefreshSignal((p) => p + 1);
          }}
        />
      )}

      {txnDialogOpen && !txnSupplier && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl space-y-3">
            <p className="font-semibold">Select supplier first:</p>
            {suppliers.map((s) => (
              <Button
                key={s.supplierid}
                variant="outline"
                className="w-full"
                onClick={() => setTxnSupplier(s)}
              >
                {s.name}
              </Button>
            ))}
            <Button variant="ghost" className="w-full" onClick={() => setTxnDialogOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual verify** — tab renders, filter by supplier works, filter by type works, Add Transaction opens correctly

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/SupplierTransactionsTab.js
git commit -m "feat: SupplierTransactionsTab — all-supplier transactions with filters"
```

---

## Task 7: SuppliersPage — Two Subtabs

**Files:**
- Modify: `src/admin/pages/SuppliersPage.js`

- [ ] **Step 1: Add Tabs imports at top of SuppliersPage.js**

```js
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import SupplierTransactionsTab from "../components/SupplierTransactionsTab";
```

- [ ] **Step 2: Replace page JSX with tabbed layout**

```jsx
export default function SuppliersPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnSupplier, setTxnSupplier] = useState(null);
  const [txnDefaultType, setTxnDefaultType] = useState("bill");
  const [ledgerDialogOpen, setLedgerDialogOpen] = useState(false);
  const [ledgerSupplier, setLedgerSupplier] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Supplier Management</h2>

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
        </TabsList>

        <TabsContent value="suppliers" className="space-y-4 pt-4">
          <div className="flex justify-end">
            <Button onClick={() => { setEditingSupplier(null); setFormOpen(true); }}>
              Add Supplier
            </Button>
          </div>
          <SupplierTable
            refreshSignal={refreshSignal}
            onEditSupplier={(s) => { setEditingSupplier(s); setFormOpen(true); }}
            onAddTransaction={(s) => { setTxnSupplier(s); setTxnDefaultType("bill"); setTxnDialogOpen(true); }}
            onViewLedger={(s) => { setLedgerSupplier(s); setLedgerDialogOpen(true); }}
          />
        </TabsContent>

        <TabsContent value="transactions" className="pt-4">
          <SupplierTransactionsTab />
        </TabsContent>
      </Tabs>

      {formOpen && (
        <SupplierForm
          defaultValues={editingSupplier}
          onSubmit={() => { setFormOpen(false); setEditingSupplier(null); setRefreshSignal((p) => p + 1); }}
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
          defaultType={txnDefaultType}
          onSuccess={() => { setTxnDialogOpen(false); setRefreshSignal((p) => p + 1); }}
        />
      )}

      {ledgerSupplier && (
        <SupplierLedgerDialog
          supplier={ledgerSupplier}
          open={ledgerDialogOpen}
          onOpenChange={setLedgerDialogOpen}
          onAddTransaction={(defaultType) => {
            setLedgerDialogOpen(false);
            setTxnSupplier(ledgerSupplier);
            setTxnDefaultType(defaultType);
            setTxnDialogOpen(true);
          }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Manual verify** — page shows two tabs, Suppliers tab works as before, Transactions tab shows all transactions, switching tabs works without error

- [ ] **Step 4: Commit**

```bash
git add src/admin/pages/SuppliersPage.js
git commit -m "feat: SuppliersPage — two-subtab layout (Suppliers | Transactions)"
```
