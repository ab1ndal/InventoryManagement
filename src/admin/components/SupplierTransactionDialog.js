// src/admin/components/SupplierTransactionDialog.js
import React from "react";
import { useForm } from "react-hook-form";
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
  type: z.enum(["bill", "payment"]),
  amount: z.coerce
    .number({ invalid_type_error: "Amount must be a number" })
    .positive("Amount must be greater than 0"),
  transaction_date: z.string().min(1, "Date is required"),
  notes: z.string().optional().transform((v) => (v?.trim() === "" ? undefined : v)),
  bill_image: z.any().optional(),
});

export default function SupplierTransactionDialog({
  supplier,
  open,
  onOpenChange,
  onSuccess,
}) {
  const [submitting, setSubmitting] = React.useState(false);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "bill",
      amount: "",
      transaction_date: today,
      notes: "",
      bill_image: null,
    },
  });

  const txnType = form.watch("type");

  // Reset form on open
  React.useEffect(() => {
    if (open) {
      form.reset({
        type: "bill",
        amount: "",
        transaction_date: today,
        notes: "",
        bill_image: null,
      });
    }
  }, [open, form]);

  const handleSubmit = async (values) => {
    setSubmitting(true);
    try {
      // 1. Insert transaction row
      const { data: txnData, error: txnError } = await supabase
        .from("supplier_transactions")
        .insert({
          supplier_id: supplier.supplierid,
          type: values.type,
          amount: values.amount,
          transaction_date: values.transaction_date,
          notes: values.notes ?? null,
        })
        .select("transaction_id")
        .single();

      if (txnError) throw txnError;

      const transaction_id = txnData.transaction_id;

      // 2. If type === bill and image provided, upload to storage
      const file = values.bill_image?.[0];
      if (values.type === "bill" && file) {
        const storagePath = `${supplier.supplierid}/${transaction_id}-${Date.now()}-${file.name}`;

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
            supplier_id: supplier.supplierid,
            image_url: urlData.publicUrl,
            storage_path: storagePath,
          });

        if (billError) throw billError;
      }

      toast.success(values.type === "bill" ? "Bill recorded" : "Payment recorded");
      onSuccess?.();
    } catch (err) {
      toast.error("Error recording transaction", { description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-white rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle>Add Transaction — {supplier?.name}</DialogTitle>
          <DialogDescription>
            Record a bill received from or a payment made to this supplier.
          </DialogDescription>
        </DialogHeader>

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
              {submitting ? "Saving..." : txnType === "bill" ? "Record Bill" : "Record Payment"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
