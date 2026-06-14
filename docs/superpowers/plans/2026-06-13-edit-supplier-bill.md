# Edit Supplier Transactions + Currency Display Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins edit existing supplier transactions (bill/payment/advance) — including line items, GST fields, and bill image — and add per-line discount %, transaction round-off, live INR previews, and auto-calculated bill totals.

**Architecture:** One schema migration adds two nullable columns. A new pure-function utility (`supplierBillCalc.js`) implements the three calculation formulas (line amount, taxable amount, bill total) and is unit-tested directly. `SupplierTransactionDialog.js` gets a `mode`/`transaction` prop pair, wider layout, the new fields, currency previews, and auto-calc wiring via `form.watch`/`form.setValue`. `SupplierTransactionsTab.js` gets an Edit button that fetches full transaction detail and opens the dialog in edit mode. `SupplierLedgerDialog.js` gets two new display fields.

**Tech Stack:** React 19, react-hook-form + zod, Supabase JS client, Tailwind, Jest (existing `src/utility/__tests__` pattern).

Spec: `docs/superpowers/specs/2026-06-13-edit-supplier-bill-design.md`

---

### Task 1: Schema migration — `discount_pct` + `round_off_amount`

**Files:**
- Create: `schema/migration_supplier_bill_discount_roundoff.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Per-line discount % and transaction-level rounding adjustment, to match
-- supplier invoice formats (e.g. "Disc. % 10%", "Rounded Off (-)0.16")
ALTER TABLE supplier_bill_line_items ADD COLUMN IF NOT EXISTS discount_pct numeric;
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS round_off_amount numeric;
```

- [ ] **Step 2: Apply the migration**

Run: `npm run migrate`
Expected: output lists `migration_supplier_bill_discount_roundoff.sql` as applied (no errors). If it errors because `_migrations`/`exec_sql` aren't set up yet, apply `schema/util_exec_migration.sql` once in the Supabase SQL editor first, then re-run.

- [ ] **Step 3: Verify columns exist**

Run:
```bash
source .env && curl -s \
  -H "apikey: $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $REACT_APP_SUPABASE_SERVICE_ROLE_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/rpc/get_schema_info" | \
  node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const rows=JSON.parse(d); console.log(rows.filter(r=>r.column_name==='discount_pct'||r.column_name==='round_off_amount'));"
```
Expected: two rows — `supplier_bill_line_items.discount_pct` and `supplier_transactions.round_off_amount`, both `numeric`, nullable.

- [ ] **Step 4: Commit**

```bash
git add schema/migration_supplier_bill_discount_roundoff.sql
git commit -m "Add discount_pct and round_off_amount columns for supplier bills"
```

---

### Task 2: `supplierBillCalc` utility (TDD)

**Files:**
- Create: `src/utility/supplierBillCalc.js`
- Test: `src/utility/__tests__/supplierBillCalc.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
import { computeLineAmount, computeTaxableAmount, computeBillTotal } from "../supplierBillCalc";

describe("computeLineAmount", () => {
  test("applies percentage discount to qty * unit_price", () => {
    expect(computeLineAmount({ qty: 3, unit_price: 2675, discount_pct: 10 })).toBe(7222.5);
  });

  test("defaults discount_pct to 0 when missing", () => {
    expect(computeLineAmount({ qty: 2, unit_price: 100 })).toBe(200);
  });

  test("treats empty/blank inputs as 0", () => {
    expect(computeLineAmount({ qty: "", unit_price: "", discount_pct: "" })).toBe(0);
  });
});

describe("computeTaxableAmount", () => {
  test("sums line item amounts from the sample invoice", () => {
    const lineItems = [
      { amount: 7222.5 },
      { amount: 7411.5 },
      { amount: 4662 },
      { amount: 2682 },
      { amount: 2565 },
    ];
    expect(computeTaxableAmount(lineItems)).toBe(24543);
  });

  test("returns 0 for an empty list", () => {
    expect(computeTaxableAmount([])).toBe(0);
  });
});

describe("computeBillTotal", () => {
  test("matches the sample invoice total with IGST and negative round-off", () => {
    expect(
      computeBillTotal({
        taxable_amount: 24543,
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 1227.16,
        round_off_amount: -0.16,
      })
    ).toBe(25770);
  });

  test("treats missing tax/round-off fields as 0", () => {
    expect(computeBillTotal({ taxable_amount: 100 })).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx cross-env CI=true npx react-scripts test src/utility/__tests__/supplierBillCalc.test.js`

(If `cross-env` isn't available, use: `CI=true npm test -- src/utility/__tests__/supplierBillCalc.test.js`)

Expected: FAIL — `Cannot find module '../supplierBillCalc'`

- [ ] **Step 3: Implement the utility**

```javascript
// src/utility/supplierBillCalc.js

/**
 * Line total after a percentage discount: qty * unit_price * (1 - discount_pct/100).
 * Rounded to 2 decimals.
 */
export function computeLineAmount({ qty, unit_price, discount_pct }) {
  const q = Number(qty) || 0;
  const price = Number(unit_price) || 0;
  const disc = Number(discount_pct) || 0;
  const amount = q * price * (1 - disc / 100);
  return Math.round(amount * 100) / 100;
}

/**
 * Sum of line item `amount` values. Rounded to 2 decimals.
 */
export function computeTaxableAmount(lineItems) {
  const sum = (lineItems || []).reduce((total, li) => total + (Number(li.amount) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Final bill total: taxable + CGST + SGST + IGST + round-off.
 * Rounded to 2 decimals. round_off_amount may be negative.
 */
export function computeBillTotal({ taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off_amount }) {
  const total =
    (Number(taxable_amount) || 0) +
    (Number(cgst_amount) || 0) +
    (Number(sgst_amount) || 0) +
    (Number(igst_amount) || 0) +
    (Number(round_off_amount) || 0);
  return Math.round(total * 100) / 100;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `CI=true npm test -- src/utility/__tests__/supplierBillCalc.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/utility/supplierBillCalc.js src/utility/__tests__/supplierBillCalc.test.js
git commit -m "Add supplierBillCalc utility for line/taxable/total calculations"
```

---

### Task 3: `SupplierTransactionDialog.js` — edit mode, auto-calc, new fields

**Files:**
- Modify: `src/admin/components/SupplierTransactionDialog.js` (full rewrite)

This task replaces the entire file. It adds: `mode`/`transaction` props with prefill, a wider dialog, `discount_pct` line-item column, `round_off_amount` field, live INR previews via a new `AmountPreview` helper, auto-calculated `line_items[].amount` / `taxable_amount` / `amount` for bills (using `supplierBillCalc`), a locked `type` field in edit mode, and an edit-mode save path (update transaction row, replace line items, optionally replace bill image in place).

- [ ] **Step 1: Replace the file contents**

```javascript
// src/admin/components/SupplierTransactionDialog.js
import React from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { logActivity } from "../../lib/activityLog";
import { money } from "../../utility/activitySummary";
import { buildBillFilename } from "../../utility/billFilename";
import { formatINR } from "../../utility/formatCurrency";
import { computeLineAmount, computeTaxableAmount, computeBillTotal } from "../../utility/supplierBillCalc";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "../../components/ui/form";

const today = new Date().toISOString().split("T")[0];

function AmountPreview({ value }) {
  const num = Number(value);
  if (value === "" || value == null || isNaN(num) || num === 0) return null;
  return <p className="text-xs text-muted-foreground mt-0.5">{formatINR(num, 2)}</p>;
}

const formSchema = z.object({
  type: z.enum(["bill", "payment", "advance"]),
  amount: z.coerce
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0"),
  transaction_date: z.string().min(1, "Date is required"),
  notes: z.string().optional().transform((v) => (v?.trim() === "" ? undefined : v)),
  invoice_number: z.string().optional().transform((v) => (v?.trim() === "" ? null : v)),
  gross_amount: z.coerce.number().nonnegative().optional().nullable(),
  discount_amount: z.coerce.number().nonnegative().optional().nullable(),
  taxable_amount: z.coerce.number().nonnegative().optional().nullable(),
  cgst_amount: z.coerce.number().nonnegative().optional().nullable(),
  sgst_amount: z.coerce.number().nonnegative().optional().nullable(),
  igst_amount: z.coerce.number().nonnegative().optional().nullable(),
  round_off_amount: z.coerce.number().optional().nullable(),
  payment_mode: z.enum(["cash", "upi", "bank", "cheque"]).optional().nullable(),
  bill_image: z.any().optional(),
  line_items: z.array(z.object({
    description: z.string().min(1),
    hsn_code: z.string().optional(),
    qty: z.coerce.number().positive(),
    unit: z.string().optional(),
    discount_pct: z.coerce.number().min(0).max(100).optional(),
    unit_price: z.coerce.number().nonnegative(),
    amount: z.coerce.number().nonnegative(),
  })).optional().default([]),
});

function SupplierPicker({ locked, onSelect }) {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState([]);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (locked) return;
    if (query.trim().length < 1) { setResults([]); setOpen(false); return; }
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("supplierid, name, gstin, phone")
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(8);
      setResults(data || []);
      setOpen(true);
    }, 200);
    return () => clearTimeout(timer);
  }, [query, locked]);

  if (locked) return null;

  return (
    <div className="relative">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search supplier name…"
        autoFocus
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-52 overflow-y-auto">
          {results.map((s) => (
            <button
              key={s.supplierid}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-blue-50 text-sm"
              onClick={() => { onSelect(s); setQuery(s.name); setOpen(false); }}
            >
              <span className="font-medium">{s.name}</span>
              {s.gstin && <span className="ml-2 text-xs text-muted-foreground">{s.gstin}</span>}
              {s.phone && <span className="ml-2 text-xs text-muted-foreground">{s.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SupplierTransactionDialog({
  supplier,
  open,
  onOpenChange,
  onSuccess,
  defaultType = "bill",
  mode = "create",
  transaction = null,
}) {
  const [submitting, setSubmitting] = React.useState(false);
  const [selectedSupplier, setSelectedSupplier] = React.useState(supplier ?? null);

  React.useEffect(() => {
    setSelectedSupplier(supplier ?? null);
  }, [supplier, open]);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "bill",
      amount: "",
      transaction_date: today,
      notes: "",
      invoice_number: "",
      gross_amount: "",
      discount_amount: "",
      taxable_amount: "",
      cgst_amount: "",
      sgst_amount: "",
      igst_amount: "",
      round_off_amount: "",
      payment_mode: null,
      bill_image: null,
      line_items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "line_items" });

  const txnType = form.watch("type");
  const watchedLineItems = form.watch("line_items");
  const watchedTaxable = form.watch("taxable_amount");
  const watchedCgst = form.watch("cgst_amount");
  const watchedSgst = form.watch("sgst_amount");
  const watchedIgst = form.watch("igst_amount");
  const watchedRoundOff = form.watch("round_off_amount");

  // Reset form on open — prefill from `transaction` in edit mode, blank in create mode
  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && transaction) {
      form.reset({
        type: transaction.type,
        amount: transaction.amount ?? "",
        transaction_date: transaction.transaction_date,
        notes: transaction.notes ?? "",
        invoice_number: transaction.invoice_number ?? "",
        gross_amount: transaction.gross_amount ?? "",
        discount_amount: transaction.discount_amount ?? "",
        taxable_amount: transaction.taxable_amount ?? "",
        cgst_amount: transaction.cgst_amount ?? "",
        sgst_amount: transaction.sgst_amount ?? "",
        igst_amount: transaction.igst_amount ?? "",
        round_off_amount: transaction.round_off_amount ?? "",
        payment_mode: transaction.payment_mode ?? null,
        bill_image: null,
        line_items: (transaction.line_items || []).map((li) => ({
          description: li.description,
          hsn_code: li.hsn_code || "",
          qty: li.qty,
          unit: li.unit || "Pcs",
          discount_pct: li.discount_pct ?? "",
          unit_price: li.unit_price,
          amount: li.amount,
        })),
      });
    } else {
      form.reset({
        type: defaultType,
        amount: "",
        transaction_date: today,
        notes: "",
        invoice_number: "",
        gross_amount: "",
        discount_amount: "",
        taxable_amount: "",
        cgst_amount: "",
        sgst_amount: "",
        igst_amount: "",
        round_off_amount: "",
        payment_mode: null,
        bill_image: null,
        line_items: [],
      });
    }
  }, [open, form, defaultType, mode, transaction]);

  // Recompute each line item's amount from qty / unit_price / discount_pct
  React.useEffect(() => {
    if (txnType !== "bill") return;
    (watchedLineItems || []).forEach((li, idx) => {
      const computed = computeLineAmount(li);
      if (Number(li.amount) !== computed) {
        form.setValue(`line_items.${idx}.amount`, computed, { shouldValidate: false });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnType, JSON.stringify((watchedLineItems || []).map((li) => [li.qty, li.unit_price, li.discount_pct]))]);

  // Recompute taxable_amount as the sum of line item amounts, when line items exist
  React.useEffect(() => {
    if (txnType !== "bill" || (watchedLineItems || []).length === 0) return;
    const computed = computeTaxableAmount(watchedLineItems);
    if (Number(form.getValues("taxable_amount")) !== computed) {
      form.setValue("taxable_amount", computed, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnType, JSON.stringify((watchedLineItems || []).map((li) => li.amount))]);

  // Recompute the top-level amount as taxable + CGST + SGST + IGST + round-off
  React.useEffect(() => {
    if (txnType !== "bill") return;
    const computed = computeBillTotal({
      taxable_amount: watchedTaxable,
      cgst_amount: watchedCgst,
      sgst_amount: watchedSgst,
      igst_amount: watchedIgst,
      round_off_amount: watchedRoundOff,
    });
    if (Number(form.getValues("amount")) !== computed) {
      form.setValue("amount", computed, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnType, watchedTaxable, watchedCgst, watchedSgst, watchedIgst, watchedRoundOff]);

  const handleSubmit = async (values) => {
    if (!selectedSupplier) {
      toast.error("Select a supplier first");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "edit") {
        const transaction_id = transaction.transaction_id;
        const isBill = transaction.type === "bill";
        const isPaymentOrAdvance = !isBill;

        const { error: updateError } = await supabase
          .from("supplier_transactions")
          .update({
            amount: values.amount,
            transaction_date: values.transaction_date,
            notes: values.notes ?? null,
            invoice_number: isBill ? (values.invoice_number ?? null) : null,
            gross_amount: isBill ? (values.gross_amount || null) : null,
            discount_amount: isBill ? (values.discount_amount || null) : null,
            taxable_amount: isBill ? (values.taxable_amount || null) : null,
            cgst_amount: isBill ? (values.cgst_amount || null) : null,
            sgst_amount: isBill ? (values.sgst_amount || null) : null,
            igst_amount: isBill ? (values.igst_amount || null) : null,
            round_off_amount: isBill ? (values.round_off_amount ?? null) : null,
            payment_mode: isPaymentOrAdvance ? (values.payment_mode ?? null) : null,
          })
          .eq("transaction_id", transaction_id);

        if (updateError) throw updateError;

        if (isBill) {
          const { error: deleteError } = await supabase
            .from("supplier_bill_line_items")
            .delete()
            .eq("transaction_id", transaction_id);

          if (deleteError) throw deleteError;

          if (values.line_items?.length > 0) {
            const { error: lineItemsError } = await supabase.from("supplier_bill_line_items").insert(
              values.line_items.map((li) => ({
                transaction_id,
                description: li.description,
                hsn_code: li.hsn_code || null,
                qty: li.qty,
                unit: li.unit || null,
                discount_pct: li.discount_pct || null,
                unit_price: li.unit_price,
                amount: li.amount,
                product_id: null,
              }))
            );
            if (lineItemsError) throw lineItemsError;
          }

          const file = values.bill_image?.[0];
          if (file) {
            const ext = file.name.split(".").pop();
            const filename = buildBillFilename({
              date: values.transaction_date,
              supplierName: selectedSupplier.name,
              invoiceNumber: values.invoice_number,
              transactionId: transaction_id,
              ext,
            });
            const storagePath = transaction.bill?.storage_path || `${selectedSupplier.supplierid}/${filename}`;

            const { error: uploadError } = await supabase.storage
              .from("supplier-bills")
              .upload(storagePath, file, { upsert: true });

            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage
              .from("supplier-bills")
              .getPublicUrl(storagePath);

            if (transaction.bill) {
              const { error: billError } = await supabase
                .from("supplier_bills")
                .update({
                  image_url: urlData.publicUrl,
                  storage_path: storagePath,
                  uploaded_at: new Date().toISOString(),
                })
                .eq("bill_id", transaction.bill.bill_id);
              if (billError) throw billError;
            } else {
              const { error: billError } = await supabase
                .from("supplier_bills")
                .insert({
                  transaction_id,
                  supplier_id: selectedSupplier.supplierid,
                  image_url: urlData.publicUrl,
                  storage_path: storagePath,
                });
              if (billError) throw billError;
            }
          }
        }

        logActivity({
          action: "update",
          entityType: isBill ? "supplier_bill" : "supplier",
          entityId: transaction_id,
          summary: `Edited ${isBill ? "supplier bill" : transaction.type === "advance" ? "supplier advance" : "supplier payment"} for supplier ${selectedSupplier.name} — ${money(values.amount)}`,
        });

        toast.success("Transaction updated");
        onSuccess?.();
        return;
      }

      const isBill = values.type === "bill";
      const isPaymentOrAdvance = values.type === "payment" || values.type === "advance";

      // 1. Insert transaction row
      const { data: txnData, error: txnError } = await supabase
        .from("supplier_transactions")
        .insert({
          supplier_id: selectedSupplier.supplierid,
          type: values.type,
          amount: values.amount,
          transaction_date: values.transaction_date,
          notes: values.notes ?? null,
          invoice_number: isBill ? (values.invoice_number ?? null) : null,
          gross_amount: isBill ? (values.gross_amount || null) : null,
          discount_amount: isBill ? (values.discount_amount || null) : null,
          taxable_amount: isBill ? (values.taxable_amount || null) : null,
          cgst_amount: isBill ? (values.cgst_amount || null) : null,
          sgst_amount: isBill ? (values.sgst_amount || null) : null,
          igst_amount: isBill ? (values.igst_amount || null) : null,
          round_off_amount: isBill ? (values.round_off_amount ?? null) : null,
          payment_mode: isPaymentOrAdvance ? (values.payment_mode ?? null) : null,
        })
        .select("transaction_id")
        .single();

      if (txnError) throw txnError;

      const transaction_id = txnData.transaction_id;

      // 2. Insert line items for bills
      if (isBill && values.line_items?.length > 0) {
        await supabase.from("supplier_bill_line_items").insert(
          values.line_items.map((li) => ({
            transaction_id: txnData.transaction_id,
            description: li.description,
            hsn_code: li.hsn_code || null,
            qty: li.qty,
            unit: li.unit || null,
            discount_pct: li.discount_pct || null,
            unit_price: li.unit_price,
            amount: li.amount,
            product_id: null,
          }))
        );
      }

      // 3. If type === bill and image provided, upload to storage
      const file = values.bill_image?.[0];
      if (isBill && file) {
        const ext = file.name.split(".").pop();
        const filename = buildBillFilename({
          date: values.transaction_date,
          supplierName: selectedSupplier.name,
          invoiceNumber: values.invoice_number,
          transactionId: transaction_id,
          ext,
        });
        const storagePath = `${selectedSupplier.supplierid}/${filename}`;

        const { error: uploadError } = await supabase.storage
          .from("supplier-bills")
          .upload(storagePath, file, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from("supplier-bills")
          .getPublicUrl(storagePath);

        const { error: billError } = await supabase
          .from("supplier_bills")
          .insert({
            transaction_id,
            supplier_id: selectedSupplier.supplierid,
            image_url: urlData.publicUrl,
            storage_path: storagePath,
          });

        if (billError) throw billError;
      }

      const typeLabel = { bill: "supplier bill", payment: "supplier payment", advance: "supplier advance" }[values.type] || "supplier transaction";
      logActivity({
        action: "create",
        entityType: values.type === "bill" ? "supplier_bill" : "supplier",
        entityId: transaction_id,
        summary: `Added ${typeLabel} for supplier ${selectedSupplier.name} — ${money(values.amount)}`,
      });

      toast.success(
        values.type === "bill" ? "Bill recorded"
        : values.type === "advance" ? "Advance recorded"
        : "Payment recorded"
      );
      onSuccess?.();
    } catch (err) {
      toast.error(mode === "edit" ? "Error updating transaction" : "Error recording transaction", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-white rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Edit Transaction" : "Add Transaction"}
            {selectedSupplier ? ` — ${selectedSupplier.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update this transaction's details."
              : "Record a bill received from or a payment made to a supplier."}
          </DialogDescription>
        </DialogHeader>

        {!supplier && (
          <div className="space-y-1">
            {selectedSupplier ? (
              <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm bg-blue-50">
                <span className="font-medium">{selectedSupplier.name}</span>
                <button
                  type="button"
                  className="text-xs text-blue-600 hover:underline"
                  onClick={() => setSelectedSupplier(null)}
                >
                  Change
                </button>
              </div>
            ) : (
              <SupplierPicker locked={false} onSelect={setSelectedSupplier} />
            )}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            {/* Type */}
            <FormField
              name="type"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      disabled={mode === "edit"}
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-gray-100 disabled:text-muted-foreground"
                    >
                      <option value="bill">Bill (debit — we owe)</option>
                      <option value="payment">Payment (credit — we paid)</option>
                      <option value="advance">Advance (credit — pre-payment)</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Amount */}
            <FormField
              name="amount"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>₹ Amount{txnType === "bill" ? " (auto-calculated)" : ""}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                      disabled={txnType === "bill"}
                    />
                  </FormControl>
                  <AmountPreview value={field.value} />
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Bill-specific fields */}
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
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    name="gross_amount"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Gross Amount (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="Pre-discount total" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    name="discount_amount"
                    control={form.control}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Discount (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="Total discount applied" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="border rounded-md p-3 space-y-3 bg-gray-50">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">GST Breakdown (optional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField name="taxable_amount" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Taxable (₹){fields.length > 0 ? " (auto)" : ""}</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" disabled={fields.length > 0} /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="cgst_amount" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>CGST (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="sgst_amount" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>SGST (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="igst_amount" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>IGST (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField name="round_off_amount" control={form.control} render={({ field }) => (
                      <FormItem>
                        <FormLabel>Round Off (₹)</FormLabel>
                        <FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl>
                        <AmountPreview value={field.value} />
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </div>
                <div className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Line Items</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => append({ description: "", hsn_code: "", qty: 1, unit: "Pcs", discount_pct: "", unit_price: "", amount: 0 })}
                    >
                      + Add Row
                    </Button>
                  </div>
                  {fields.length > 0 && (
                    <div className="overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-left pb-1 pr-2">Description</th>
                            <th className="text-left pb-1 pr-2 w-20">HSN</th>
                            <th className="text-right pb-1 pr-2 w-16">Qty</th>
                            <th className="text-left pb-1 pr-2 w-16">Unit</th>
                            <th className="text-right pb-1 pr-2 w-16">Disc %</th>
                            <th className="text-right pb-1 pr-2 w-24">Price (₹)</th>
                            <th className="text-right pb-1 pr-2 w-24">Amount (₹) — auto</th>
                            <th className="w-6"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((field, idx) => (
                            <tr key={field.id}>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.description`)} placeholder="e.g. SHIRTS" /></td>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.hsn_code`)} placeholder="620590" /></td>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.qty`)} type="number" step="0.01" className="text-right" /></td>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.unit`)} placeholder="Pcs" /></td>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.discount_pct`)} type="number" step="0.01" min="0" max="100" className="text-right" placeholder="0" /></td>
                              <td className="pr-2 pb-1">
                                <Input {...form.register(`line_items.${idx}.unit_price`)} type="number" step="0.01" className="text-right" />
                                <AmountPreview value={watchedLineItems?.[idx]?.unit_price} />
                              </td>
                              <td className="pr-2 pb-1">
                                <Input {...form.register(`line_items.${idx}.amount`)} type="number" step="0.01" className="text-right" disabled />
                                <AmountPreview value={watchedLineItems?.[idx]?.amount} />
                              </td>
                              <td><button type="button" onClick={() => remove(idx)} className="text-red-400 hover:text-red-600 text-base leading-none">×</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Date */}
            <FormField
              name="transaction_date"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Notes */}
            <FormField
              name="notes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} placeholder="Optional notes..." />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Payment mode — only for payment/advance */}
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

            {/* Bill image — only shown for bill type */}
            {txnType === "bill" && (
              <FormField
                name="bill_image"
                control={form.control}
                render={({ field: { onChange, value, ...rest } }) => (
                  <FormItem>
                    <FormLabel>Bill Document — image or PDF (optional)</FormLabel>
                    {mode === "edit" && transaction?.bill?.image_url && (
                      <p className="text-xs text-muted-foreground">
                        Current file: <a href={transaction.bill.image_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">View ↗</a> — choose a file below to replace it.
                      </p>
                    )}
                    <FormControl>
                      <Input
                        {...rest}
                        type="file"
                        accept="image/*,application/pdf"
                        onChange={(e) => onChange(e.target.files)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Saving..." : mode === "edit" ? "Save Changes" : txnType === "bill" ? "Record Bill" : txnType === "advance" ? "Record Advance" : "Record Payment"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: builds with no new errors/warnings from this file (pre-existing warnings elsewhere are fine).

- [ ] **Step 3: Manual smoke test — create mode (no regression)**

Run: `npm start`, go to `/admin/suppliers`, open Supplier Transactions tab, click "+ Add Transaction", pick a supplier, type "Bill".

Enter the sample invoice:
- Line 1: Saree, HSN 540752, Qty 3, Unit pcs, Disc % 10, Price 2675
- Line 2: Saree, HSN 540752, Qty 3, Unit pcs, Disc % 10, Price 2745
- Line 3: Saree, HSN 540752, Qty 4, Unit pcs, Disc % 10, Price 1295
- Line 4: Saree, HSN 540752, Qty 2, Unit pcs, Disc % 10, Price 1490
- Line 5: Saree, HSN 540752, Qty 2, Unit pcs, Disc % 10, Price 1425
- IGST: 1227.16
- Round Off: -0.16

Expected:
- Each line's Amount column auto-fills (7222.50 / 7411.50 / 4662.00 / 2682.00 / 2565.00), each showing a `₹...` preview line
- Taxable (₹) auto-fills to 24,543.00 and becomes disabled (greyed)
- ₹ Amount (top) auto-fills to 25,770.00 and is disabled
- Save succeeds, dialog closes, new row appears in the transactions table

- [ ] **Step 4: Commit**

```bash
git add src/admin/components/SupplierTransactionDialog.js
git commit -m "Add edit mode, discount/round-off fields, and auto-calculated bill totals to SupplierTransactionDialog"
```

---

### Task 4: `SupplierTransactionsTab.js` — Edit button + edit dialog wiring

**Files:**
- Modify: `src/admin/components/SupplierTransactionsTab.js`

- [ ] **Step 1: Add edit state and fetch handler**

In `SupplierTransactionsTab.js`, after the existing state declarations (around the `txnSupplier`/`refreshSignal` state, line 16-17), add:

```javascript
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTransaction, setEditTransaction] = useState(null);
```

After the `fetchAll` function (after its closing `};`, around line 38), add:

```javascript
  const handleEditClick = async (t) => {
    let line_items = [];
    let bill = null;
    if (t.type === "bill") {
      const [{ data: liData }, { data: billData }] = await Promise.all([
        supabase.from("supplier_bill_line_items").select("*").eq("transaction_id", t.transaction_id),
        supabase.from("supplier_bills").select("*").eq("transaction_id", t.transaction_id).maybeSingle(),
      ]);
      line_items = liData || [];
      bill = billData || null;
    }
    setEditTransaction({ ...t, line_items, bill });
    setEditDialogOpen(true);
  };
```

- [ ] **Step 2: Add the Actions column header**

Find the `<thead>` block (around line 93-104). Add a new `<th>` after the "Notes" header:

```javascript
                <th className="p-3 font-semibold">Notes</th>
                <th className="p-3 font-semibold">Actions</th>
```

- [ ] **Step 3: Update the empty-row colspan and add the Edit cell**

Find the empty-state row (`colSpan={8}`, around line 108) and change it to `colSpan={9}`.

In the row-mapping `<tr>` (around line 112-129), add a new `<td>` after the Notes `<td>`:

```javascript
                    <td className="p-3 text-xs text-muted-foreground max-w-[160px] truncate">{t.notes || "—"}</td>
                    <td className="p-3">
                      <Button size="sm" variant="outline" onClick={() => handleEditClick(t)}>
                        Edit
                      </Button>
                    </td>
```

- [ ] **Step 4: Render the edit dialog**

After the existing `{txnDialogOpen && !txnSupplier && (...)}` block (around line 166, just before the closing `</div>` of the component), add:

```javascript
      {editDialogOpen && editTransaction && (
        <SupplierTransactionDialog
          mode="edit"
          transaction={editTransaction}
          supplier={{ supplierid: editTransaction.supplier_id, name: editTransaction.suppliers?.name }}
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          onSuccess={() => {
            setEditDialogOpen(false);
            setEditTransaction(null);
            setRefreshSignal((p) => p + 1);
          }}
        />
      )}
```

- [ ] **Step 5: Manual smoke test**

Run: `npm start`, go to Supplier Transactions tab. Confirm:
- "Actions" column with "Edit" button appears on every row
- Clicking Edit on a bill row opens the dialog titled "Edit Transaction — <supplier>", `Type` select disabled showing "Bill...", line items pre-filled with their original values and computed amounts, "₹ Amount" disabled showing the original total
- Edit the first line item's qty, confirm its Amount, Taxable, and top ₹ Amount all update live
- Click "Save Changes" — toast "Transaction updated", dialog closes, table row reflects new amount
- Clicking Edit on a payment/advance row opens the dialog with Type disabled = "Payment"/"Advance", amount/date/notes/payment mode editable and pre-filled; save works

- [ ] **Step 6: Commit**

```bash
git add src/admin/components/SupplierTransactionsTab.js
git commit -m "Add Edit action to SupplierTransactionsTab, wired to SupplierTransactionDialog edit mode"
```

---

### Task 5: `SupplierLedgerDialog.js` — show discount % and round-off

**Files:**
- Modify: `src/admin/components/SupplierLedgerDialog.js`

- [ ] **Step 1: Add the "Disc %" column to the line items table**

In the line-items `<thead>` (around line 260-271), add a new `<th>` between "Unit" and "Price":

```javascript
                                        <th className="p-1 text-left">Unit</th>
                                        <th className="p-1 text-right">Disc %</th>
                                        <th className="p-1 text-right">Price</th>
```

In the line-items row mapping (around line 273-288), add a new `<td>` between the Unit cell and the Price cell:

```javascript
                                          <td className="p-1">{li.unit || "—"}</td>
                                          <td className="p-1 text-right">{li.discount_pct ? `${li.discount_pct}%` : "—"}</td>
                                          <td className="p-1 text-right">{formatINR(li.unit_price, 2)}</td>
```

- [ ] **Step 2: Add "Round Off" to the bill detail grid**

In the bill detail grid (around line 242-250), add a new `<div>` after the IGST one:

```javascript
                                  {row.igst_amount && <div><span className="font-medium">IGST:</span> {formatINR(row.igst_amount, 2)}</div>}
                                  {row.round_off_amount != null && Number(row.round_off_amount) !== 0 && <div><span className="font-medium">Round Off:</span> {formatINR(row.round_off_amount, 2)}</div>}
```

- [ ] **Step 3: Manual smoke test**

Run: `npm start`, open a supplier's Ledger (from Suppliers page), expand a bill row edited in Task 4. Confirm:
- Line items table shows a "Disc %" column with the entered percentages
- Detail grid shows "Round Off: ₹(-)0.16" (or equivalent) when set

- [ ] **Step 4: Commit**

```bash
git add src/admin/components/SupplierLedgerDialog.js
git commit -m "Show discount % and round-off amount in SupplierLedgerDialog"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `CI=true npm test -- --watchAll=false`
Expected: all tests pass, including the new `supplierBillCalc.test.js`.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 3: Manual end-to-end pass**

Using `npm start`:
1. Create a new bill with the sample invoice values (Task 3 Step 3) — verify totals computed correctly and bill saves.
2. Edit that bill: change one line item's `discount_pct` from 10 to 5, verify line amount, taxable amount, and final amount all update live and persist after save.
3. Edit the same bill again: upload a replacement PDF in "Bill Document" — verify it uploads, `View ↗` link in the dialog and in `SupplierLedgerDialog` both resolve to the new file.
4. Edit a payment or advance transaction — change amount/date/notes/payment mode, save, verify `SupplierTransactionsTab` reflects changes.
5. Open `SupplierLedgerDialog` for the supplier, expand the edited bill — confirm Disc % column and Round Off line show correctly, and running balance/totals at the bottom reflect the edited amount.

- [ ] **Step 4: Update graphify graph**

Run: `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`
