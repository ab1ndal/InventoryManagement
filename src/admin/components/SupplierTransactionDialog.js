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
import { computeLineAmount, computeTaxableAmount, computeGrossAmount, computeDiscountAmount, computeBillTotal } from "../../utility/supplierBillCalc";
import { Input } from "../../components/ui/input";
import { CurrencyInput } from "../../components/ui/currency-input";
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


const formSchema = z.object({
  type: z.enum(["bill", "payment", "advance", "return"]),
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
  const [deletedBillIds, setDeletedBillIds] = React.useState([]);
  const [deletingBillId, setDeletingBillId] = React.useState(null);

  // Edit-mode transaction available at mount — used to seed `type` / `detailedReturn`
  // so `billLike` is correct on the FIRST render. Otherwise the default type "bill"
  // makes billLike=true, and the bill-total recompute effect clobbers the just-reset
  // amount to 0 for payments / simple returns (they have no taxable to self-heal from).
  const editTxn = mode === "edit" && transaction ? transaction : null;
  const isDetailedReturn = (t) =>
    !!t && t.type === "return" && ((t.line_items?.length > 0) || !!t.invoice_number);

  const [detailedReturn, setDetailedReturn] = React.useState(() => isDetailedReturn(editTxn));

  React.useEffect(() => {
    setSelectedSupplier(supplier ?? null);
  }, [supplier, open]);

  React.useEffect(() => {
    setDeletedBillIds([]);
  }, [open, transaction]);

  const handleDeleteBill = async (bill) => {
    if (!window.confirm("Delete this bill document?")) return;
    setDeletingBillId(bill.bill_id);
    try {
      if (bill.storage_path) {
        await supabase.storage.from("supplier-bills").remove([bill.storage_path]);
      }
      const { error } = await supabase
        .from("supplier_bills")
        .delete()
        .eq("bill_id", bill.bill_id);
      if (error) throw error;
      setDeletedBillIds((prev) => [...prev, bill.bill_id]);
      toast.success("Bill document deleted");
    } catch (err) {
      toast.error("Error deleting bill document", { description: err.message });
    } finally {
      setDeletingBillId(null);
    }
  };

  const existingBills = (transaction?.bills || []).filter((b) => !deletedBillIds.includes(b.bill_id));

  const handleViewBill = async (bill) => {
    const path = bill.storage_path || bill.image_url;
    if (!path) return;
    const { data, error } = await supabase.storage.from("supplier-bills").createSignedUrl(path, 3600);
    if (error) {
      toast.error("Error opening bill document", { description: error.message });
      return;
    }
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  // Uploads each selected bill file to storage and inserts a supplier_bills row per file.
  // When multiple files are uploaded together, filenames get a "_1", "_2", ... suffix
  // in upload order.
  const uploadBillFiles = async ({ files, values, transaction_id }) => {
    const fileList = Array.from(files || []);
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = file.name.split(".").pop();
      const filename = buildBillFilename({
        date: values.transaction_date,
        supplierName: selectedSupplier.name,
        invoiceNumber: values.invoice_number,
        transactionId: transaction_id,
        ext,
        suffix: fileList.length > 1 ? String(i + 1) : undefined,
      });
      const storagePath = `${selectedSupplier.supplierid}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from("supplier-bills")
        .upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { error: billError } = await supabase
        .from("supplier_bills")
        .insert({
          transaction_id,
          supplier_id: selectedSupplier.supplierid,
          image_url: storagePath,
          storage_path: storagePath,
        });
      if (billError) throw billError;
    }
  };

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: editTxn ? editTxn.type : defaultType,
      amount: editTxn ? (editTxn.amount ?? "") : "",
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

  // A "detailed return" carries the same fields as a bill (invoice, line items, GST, docs).
  // billLike drives every place the bill-detail UI / calc / persistence applies.
  const billLike = txnType === "bill" || (txnType === "return" && detailedReturn);

  // Reset form on open — prefill from `transaction` in edit mode, blank in create mode
  React.useEffect(() => {
    if (!open) return;
    if (mode === "edit" && transaction) {
      setDetailedReturn(
        transaction.type === "return" &&
          ((transaction.line_items?.length > 0) || !!transaction.invoice_number)
      );
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
      setDetailedReturn(false);
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
    if (!billLike) return;
    (watchedLineItems || []).forEach((li, idx) => {
      const computed = computeLineAmount(li);
      if (Number(li.amount) !== computed) {
        form.setValue(`line_items.${idx}.amount`, computed, { shouldValidate: false });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billLike, JSON.stringify((watchedLineItems || []).map((li) => [li.qty, li.unit_price, li.discount_pct]))]);

  // Recompute taxable_amount as the sum of line item amounts, when line items exist
  React.useEffect(() => {
    if (!billLike || (watchedLineItems || []).length === 0) return;
    const computed = computeTaxableAmount(watchedLineItems);
    if (Number(form.getValues("taxable_amount")) !== computed) {
      form.setValue("taxable_amount", computed, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billLike, JSON.stringify((watchedLineItems || []).map((li) => li.amount))]);

  // Recompute gross_amount and discount_amount from line items, when line items exist
  React.useEffect(() => {
    if (!billLike || (watchedLineItems || []).length === 0) return;
    const computedGross = computeGrossAmount(watchedLineItems);
    if (Number(form.getValues("gross_amount")) !== computedGross) {
      form.setValue("gross_amount", computedGross, { shouldValidate: false });
    }
    const computedDiscount = computeDiscountAmount(watchedLineItems);
    if (Number(form.getValues("discount_amount")) !== computedDiscount) {
      form.setValue("discount_amount", computedDiscount, { shouldValidate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billLike, JSON.stringify((watchedLineItems || []).map((li) => [li.qty, li.unit_price, li.amount]))]);

  // Recompute the top-level amount as taxable + CGST + SGST + IGST + round-off
  React.useEffect(() => {
    if (!billLike) return;
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
  }, [billLike, watchedTaxable, watchedCgst, watchedSgst, watchedIgst, watchedRoundOff]);

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
        const isPaymentOrAdvance = transaction.type === "payment" || transaction.type === "advance";
        // detail = persist bill-like fields; manageDetail = type that *can* carry them
        // (so unchecking "detailed" on a return clears its old line items / columns).
        const detail = billLike;
        const manageDetail = isBill || transaction.type === "return";

        const { error: updateError } = await supabase
          .from("supplier_transactions")
          .update({
            amount: values.amount,
            transaction_date: values.transaction_date,
            notes: values.notes ?? null,
            invoice_number: detail ? (values.invoice_number ?? null) : null,
            gross_amount: detail ? (values.gross_amount || null) : null,
            discount_amount: detail ? (values.discount_amount || null) : null,
            taxable_amount: detail ? (values.taxable_amount || null) : null,
            cgst_amount: detail ? (values.cgst_amount || null) : null,
            sgst_amount: detail ? (values.sgst_amount || null) : null,
            igst_amount: detail ? (values.igst_amount || null) : null,
            round_off_amount: detail ? (values.round_off_amount ?? null) : null,
            payment_mode: isPaymentOrAdvance ? (values.payment_mode ?? null) : null,
          })
          .eq("transaction_id", transaction_id);

        if (updateError) throw updateError;

        if (manageDetail) {
          const { error: deleteError } = await supabase
            .from("supplier_bill_line_items")
            .delete()
            .eq("transaction_id", transaction_id);

          if (deleteError) throw deleteError;

          if (detail && values.line_items?.length > 0) {
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

          await uploadBillFiles({ files: values.bill_image, values, transaction_id });
        }

        logActivity({
          action: "update",
          entityType: isBill ? "supplier_bill" : "supplier",
          entityId: transaction_id,
          summary: `Edited ${isBill ? "supplier bill" : transaction.type === "advance" ? "supplier advance" : transaction.type === "return" ? "supplier return" : "supplier payment"} for supplier ${selectedSupplier.name} — ${money(values.amount)}`,
        });

        toast.success("Transaction updated");
        onSuccess?.();
        return;
      }

      const isPaymentOrAdvance = values.type === "payment" || values.type === "advance";
      // detail = bill, or a return flagged "detailed" — both carry bill-like fields.
      const detail = billLike;

      // 1. Insert transaction row
      const { data: txnData, error: txnError } = await supabase
        .from("supplier_transactions")
        .insert({
          supplier_id: selectedSupplier.supplierid,
          type: values.type,
          amount: values.amount,
          transaction_date: values.transaction_date,
          notes: values.notes ?? null,
          invoice_number: detail ? (values.invoice_number ?? null) : null,
          gross_amount: detail ? (values.gross_amount || null) : null,
          discount_amount: detail ? (values.discount_amount || null) : null,
          taxable_amount: detail ? (values.taxable_amount || null) : null,
          cgst_amount: detail ? (values.cgst_amount || null) : null,
          sgst_amount: detail ? (values.sgst_amount || null) : null,
          igst_amount: detail ? (values.igst_amount || null) : null,
          round_off_amount: detail ? (values.round_off_amount ?? null) : null,
          payment_mode: isPaymentOrAdvance ? (values.payment_mode ?? null) : null,
        })
        .select("transaction_id")
        .single();

      if (txnError) throw txnError;

      const transaction_id = txnData.transaction_id;

      // 2. Insert line items for bills / detailed returns
      if (detail && values.line_items?.length > 0) {
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

      // 3. Upload any attached documents (bills / detailed returns)
      if (detail) {
        await uploadBillFiles({ files: values.bill_image, values, transaction_id });
      }

      const typeLabel = { bill: "supplier bill", payment: "supplier payment", advance: "supplier advance", return: "supplier return" }[values.type] || "supplier transaction";
      logActivity({
        action: "create",
        entityType: values.type === "bill" ? "supplier_bill" : "supplier",
        entityId: transaction_id,
        summary: `Added ${typeLabel} for supplier ${selectedSupplier.name} — ${money(values.amount)}`,
      });

      toast.success(
        values.type === "bill" ? "Bill recorded"
        : values.type === "advance" ? "Advance recorded"
        : values.type === "return" ? "Return recorded"
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
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
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
                      <option value="payment">
                        Payment (credit — we paid)
                      </option>
                      <option value="advance">
                        Advance (credit — pre-payment)
                      </option>
                      <option value="return">
                        Return (credit — defective goods)
                      </option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Detailed return toggle — reveals the same fields a bill uses */}
            {txnType === "return" && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={detailedReturn}
                  onChange={(e) => setDetailedReturn(e.target.checked)}
                  className="h-4 w-4"
                />
                Add bill details (invoice, items, GST, documents)
              </label>
            )}

            {/* Amount — simple (non-detailed) types shown up top; detailed types auto-calc below */}
            {!billLike && (
              <FormField
                name="amount"
                control={form.control}
                render={() => (
                  <FormItem>
                    <FormLabel>Amount (₹)</FormLabel>
                    <FormControl>
                      <CurrencyInput control={form.control} name="amount" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Bill / detailed-return fields */}
            {billLike && (
              <>
                <div className="grid grid-cols-2 gap-3">
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
                </div>
                <div className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Line Items
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        append({
                          description: "",
                          hsn_code: "",
                          qty: 1,
                          unit: "Pcs",
                          discount_pct: "",
                          unit_price: "",
                          amount: 0,
                        })
                      }
                    >
                      + Add Row
                    </Button>
                  </div>
                  {fields.length > 0 && (
                    <div className="overflow-auto">
                      <table className="min-w-full text-[10px] sm:text-xs">
                        <thead>
                          <tr className="text-muted-foreground">
                            <th className="text-center pb-1 pr-2">
                              Description
                            </th>
                            <th className="text-center pb-1 pr-2 w-24">HSN</th>
                            <th className="text-center pb-1 pr-2 w-16">Qty</th>
                            <th className="text-center pb-1 pr-2 w-16">Unit</th>
                            <th className="text-center pb-1 pr-2 w-16">
                              Disc %
                            </th>
                            <th className="text-center pb-1 pr-2 w-28">
                              Price (₹)
                            </th>
                            <th className="text-center pb-1 pr-2 w-28">
                              Amount (₹)
                            </th>
                            <th className="w-6"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((field, idx) => (
                            <tr key={field.id}>
                              <td className="pr-2 pb-1">
                                <Input
                                  {...form.register(
                                    `line_items.${idx}.description`,
                                  )}
                                  placeholder="e.g. SHIRTS"
                                  className="text-[11px] sm:text-sm"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <Input
                                  {...form.register(
                                    `line_items.${idx}.hsn_code`,
                                  )}
                                  placeholder="620590"
                                  className="text-[11px] sm:text-sm"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <Input
                                  {...form.register(`line_items.${idx}.qty`)}
                                  type="number"
                                  step={
                                    watchedLineItems?.[idx]?.unit === "Pcs"
                                      ? "1"
                                      : "0.01"
                                  }
                                  className="text-right text-[11px] sm:text-sm"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <Input
                                  {...form.register(`line_items.${idx}.unit`)}
                                  placeholder="Pcs"
                                  className="text-[11px] sm:text-sm"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <Input
                                  {...form.register(
                                    `line_items.${idx}.discount_pct`,
                                  )}
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  max="100"
                                  className="text-right text-[11px] sm:text-sm"
                                  placeholder="0"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <CurrencyInput
                                  control={form.control}
                                  name={`line_items.${idx}.unit_price`}
                                  className="text-right text-[11px] sm:text-sm"
                                />
                              </td>
                              <td className="pr-2 pb-1">
                                <CurrencyInput
                                  control={form.control}
                                  name={`line_items.${idx}.amount`}
                                  className="text-right text-[11px] sm:text-sm"
                                  disabled
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  onClick={() => remove(idx)}
                                  className="text-red-400 hover:text-red-600 text-base leading-none"
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    name="gross_amount"
                    control={form.control}
                    render={() => (
                      <FormItem>
                        <FormLabel>
                          Gross Amount (₹){fields.length > 0 ? " — auto" : ""}
                        </FormLabel>
                        <FormControl>
                          <CurrencyInput
                            control={form.control}
                            name="gross_amount"
                            disabled={fields.length > 0}
                            placeholder="Pre-discount total"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    name="discount_amount"
                    control={form.control}
                    render={() => (
                      <FormItem>
                        <FormLabel>
                          Discount (₹){fields.length > 0 ? " — auto" : ""}
                        </FormLabel>
                        <FormControl>
                          <CurrencyInput
                            control={form.control}
                            name="discount_amount"
                            disabled={fields.length > 0}
                            placeholder="Total discount applied"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="border rounded-md p-3 space-y-3 bg-gray-50">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    GST Breakdown (optional)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      name="taxable_amount"
                      control={form.control}
                      render={() => (
                        <FormItem>
                          <FormLabel>
                            Taxable (₹){fields.length > 0 ? " — auto" : ""}
                          </FormLabel>
                          <FormControl>
                            <CurrencyInput
                              control={form.control}
                              name="taxable_amount"
                              disabled={fields.length > 0}
                              placeholder="0.00"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      name="cgst_amount"
                      control={form.control}
                      render={() => (
                        <FormItem>
                          <FormLabel>CGST (₹)</FormLabel>
                          <FormControl>
                            <CurrencyInput control={form.control} name="cgst_amount" placeholder="0.00" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      name="sgst_amount"
                      control={form.control}
                      render={() => (
                        <FormItem>
                          <FormLabel>SGST (₹)</FormLabel>
                          <FormControl>
                            <CurrencyInput control={form.control} name="sgst_amount" placeholder="0.00" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      name="igst_amount"
                      control={form.control}
                      render={() => (
                        <FormItem>
                          <FormLabel>IGST (₹)</FormLabel>
                          <FormControl>
                            <CurrencyInput control={form.control} name="igst_amount" placeholder="0.00" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      name="round_off_amount"
                      control={form.control}
                      render={() => (
                        <FormItem>
                          <FormLabel>Round Off (₹)</FormLabel>
                          <FormControl>
                            <CurrencyInput control={form.control} name="round_off_amount" placeholder="0.00" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
                <FormField
                  name="amount"
                  control={form.control}
                  render={() => (
                    <FormItem>
                      <FormLabel>Amount (₹) — auto</FormLabel>
                      <FormControl>
                        <CurrencyInput control={form.control} name="amount" disabled />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {/* Date — simple types shown here; bill / detailed-return have date in their grid */}
            {!billLike && (
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
            )}

            {/* Notes */}
            <FormField
              name="notes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={2}
                      placeholder="Optional notes..."
                    />
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

            {/* Document upload — bills and detailed returns */}
            {billLike && (
              <FormField
                name="bill_image"
                control={form.control}
                render={({ field: { onChange, value, ...rest } }) => (
                  <FormItem>
                    <FormLabel>
                      Bill Documents — images or PDF, multiple allowed (optional)
                    </FormLabel>
                    {mode === "edit" && existingBills.length > 0 && (
                      <ul className="text-xs text-muted-foreground space-y-1">
                        {existingBills.map((bill) => (
                          <li key={bill.bill_id} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleViewBill(bill)}
                              className="text-blue-600 hover:underline"
                            >
                              {bill.storage_path?.split("/").pop() || "View ↗"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteBill(bill)}
                              disabled={deletingBillId === bill.bill_id}
                              className="text-red-500 hover:text-red-700 hover:underline disabled:opacity-50"
                            >
                              {deletingBillId === bill.bill_id ? "Deleting…" : "Delete"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <FormControl>
                      <Input
                        {...rest}
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={(e) => onChange(e.target.files)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting
                ? "Saving..."
                : mode === "edit"
                  ? "Save Changes"
                  : txnType === "bill"
                    ? "Record Bill"
                    : txnType === "advance"
                      ? "Record Advance"
                      : txnType === "return"
                        ? "Record Return"
                        : "Record Payment"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
