// src/admin/components/SupplierForm.js
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { formatLivePhoneInput } from "../../utility/formatPhone";
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
  opening_balance_date: z.string().optional().nullable(),
});

export default function SupplierForm({
  defaultValues,
  onSubmit,
  openExternally,
  setOpenExternally,
  triggerLabel = "Add Supplier",
}) {
  const isEditing = !!(defaultValues?.supplierid);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      phone: defaultValues?.phone ?? "",
      email: defaultValues?.email ?? "",
      notes: defaultValues?.notes ?? "",
      gstin: defaultValues?.gstin ?? "",
      pan: defaultValues?.pan ?? "",
      address: defaultValues?.address ?? "",
      opening_balance: defaultValues?.opening_balance ?? 0,
      opening_balance_date: defaultValues?.opening_balance_date ?? "",
    },
  });

  // Reset form when defaultValues change (e.g. switching between add/edit)
  React.useEffect(() => {
    form.reset({
      name: defaultValues?.name ?? "",
      phone: defaultValues?.phone ?? "",
      email: defaultValues?.email ?? "",
      notes: defaultValues?.notes ?? "",
      gstin: defaultValues?.gstin ?? "",
      pan: defaultValues?.pan ?? "",
      address: defaultValues?.address ?? "",
      opening_balance: defaultValues?.opening_balance ?? 0,
      opening_balance_date: defaultValues?.opening_balance_date ?? "",
    });
  }, [defaultValues, form]);

  const handleSubmit = async (values) => {
    try {
      const payload = {
        name: values.name,
        phone: values.phone ?? null,
        email: values.email ?? null,
        notes: values.notes ?? null,
        gstin: values.gstin ?? null,
        pan: values.pan ?? null,
        address: values.address ?? null,
        opening_balance: values.opening_balance,
        opening_balance_date: values.opening_balance_date || null,
      };

      let error;
      if (isEditing) {
        ({ error } = await supabase
          .from("suppliers")
          .update(payload)
          .eq("supplierid", defaultValues.supplierid));
      } else {
        ({ error } = await supabase.from("suppliers").insert(payload));
      }

      if (error) throw error;

      toast.success(`Supplier ${isEditing ? "updated" : "added"} successfully`);
      onSubmit?.();
    } catch (err) {
      toast.error("Error saving supplier", { description: err.message });
    }
  };

  return (
    <Dialog open={openExternally} onOpenChange={setOpenExternally}>
      <DialogContent className="max-w-lg bg-white rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
          <DialogDescription>
            {isEditing ? "Update" : "Enter"} supplier details.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Supplier name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                name="phone"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(e) =>
                          field.onChange(formatLivePhoneInput(e.target.value))
                        }
                        placeholder="+91XXXXXXXXXX"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                name="email"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="email@example.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            <div className="grid grid-cols-2 gap-4">
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
              <FormField
                name="opening_balance_date"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opening Balance Date</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              name="notes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={3}
                      placeholder="Any notes about this supplier..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full">
              {isEditing ? "Update" : "Save"} Supplier
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
