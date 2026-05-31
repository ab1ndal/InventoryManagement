// src/admin/components/SupplierTransactionDialog.js
import React from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
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
  payment_mode: z.enum(["cash", "upi", "bank", "cheque"]).optional().nullable(),
  bill_image: z.any().optional(),
  line_items: z.array(z.object({
    description: z.string().min(1),
    hsn_code: z.string().optional(),
    qty: z.coerce.number().positive(),
    unit: z.string().optional(),
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
      payment_mode: null,
      bill_image: null,
      line_items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "line_items" });

  const txnType = form.watch("type");

  // Reset form on open
  React.useEffect(() => {
    if (open) {
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
        payment_mode: null,
        bill_image: null,
        line_items: [],
      });
    }
  }, [open, form, defaultType]);

  const handleSubmit = async (values) => {
    if (!selectedSupplier) {
      toast.error("Select a supplier first");
      return;
    }
    setSubmitting(true);
    try {
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
            unit_price: li.unit_price,
            amount: li.amount,
            product_id: null,
          }))
        );
      }

      // 3. If type === bill and image provided, upload to storage
      const file = values.bill_image?.[0];
      if (isBill && file) {
        const storagePath = `${selectedSupplier.supplierid}/${transaction_id}-${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("supplier-bills")
          .upload(storagePath, file);

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

      toast.success(
        values.type === "bill" ? "Bill recorded"
        : values.type === "advance" ? "Advance recorded"
        : "Payment recorded"
      );
      onSuccess?.();
    } catch (err) {
      toast.error("Error recording transaction", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white rounded-lg shadow-xl p-6 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Add Transaction{selectedSupplier ? ` — ${selectedSupplier.name}` : ""}
          </DialogTitle>
          <DialogDescription>
            Record a bill received from or a payment made to a supplier.
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
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
                  <FormLabel>₹ Amount</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="0.00"
                    />
                  </FormControl>
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="border rounded-md p-3 space-y-3 bg-gray-50">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">GST Breakdown (optional)</p>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField name="taxable_amount" control={form.control} render={({ field }) => (
                      <FormItem><FormLabel>Taxable (₹)</FormLabel><FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField name="cgst_amount" control={form.control} render={({ field }) => (
                      <FormItem><FormLabel>CGST (₹)</FormLabel><FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField name="sgst_amount" control={form.control} render={({ field }) => (
                      <FormItem><FormLabel>SGST (₹)</FormLabel><FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl><FormMessage /></FormItem>
                    )} />
                    <FormField name="igst_amount" control={form.control} render={({ field }) => (
                      <FormItem><FormLabel>IGST (₹)</FormLabel><FormControl><Input {...field} type="number" step="0.01" placeholder="0.00" /></FormControl><FormMessage /></FormItem>
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
                      onClick={() => append({ description: "", hsn_code: "", qty: 1, unit: "Pcs", unit_price: "", amount: "" })}
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
                            <th className="text-right pb-1 pr-2 w-24">Price (₹)</th>
                            <th className="text-right pb-1 pr-2 w-24">Amount (₹)</th>
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
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.unit_price`)} type="number" step="0.01" className="text-right" /></td>
                              <td className="pr-2 pb-1"><Input {...form.register(`line_items.${idx}.amount`)} type="number" step="0.01" className="text-right" /></td>
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
                    <FormLabel>Bill Image (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...rest}
                        type="file"
                        accept="image/*"
                        onChange={(e) => onChange(e.target.files)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? "Saving..." : txnType === "bill" ? "Record Bill" : txnType === "advance" ? "Record Advance" : "Record Payment"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
