import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";

const salespersonSchema = z.object({
  name: z.string().min(1, "Required").max(100, "Max 100 characters"),
  date_hired: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

function Field({ label, required, children, error }) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-red-500">{error.message}</p>}
    </div>
  );
}

export default function SalespersonForm({ defaultValues, onSuccess, onCancel }) {
  const [saving, setSaving] = useState(false);
  const isEdit = Boolean(defaultValues?.salesperson_id);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(salespersonSchema),
    defaultValues: {
      name: defaultValues?.name ?? "",
      date_hired: defaultValues?.date_hired ?? "",
      active: defaultValues?.active ?? true,
    },
  });

  const onFormSubmit = async (data) => {
    setSaving(true);

    const payload = {
      name: data.name.trim(),
      date_hired: data.date_hired || null,
      active: data.active ?? true,
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase
        .from("salespersons")
        .update(payload)
        .eq("salesperson_id", defaultValues.salesperson_id));
    } else {
      ({ error } = await supabase.from("salespersons").insert(payload));
    }

    setSaving(false);
    if (error) {
      toast.error("Failed to save salesperson", { description: error.message });
    } else {
      toast.success(isEdit ? "Salesperson updated" : "Salesperson added");
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <Field label="Name" required error={errors.name}>
        <Input {...register("name")} placeholder="e.g. Rajesh Kumar" />
      </Field>

      <Field label="Date Hired" error={errors.date_hired}>
        <Input type="date" {...register("date_hired")} />
      </Field>

      <Field label="Active" error={errors.active}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="active"
            {...register("active")}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="active" className="text-sm text-muted-foreground">
            Mark as active
          </label>
        </div>
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Update Salesperson" : "Add Salesperson"}
        </Button>
      </div>
    </form>
  );
}
