import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";

const categorySchema = z.object({
  categoryid: z
    .string()
    .min(1, "Required")
    .max(10, "Max 10 characters")
    .regex(/^[A-Z0-9]+$/, "Uppercase letters and numbers only"),
  name: z.string().min(1, "Required").max(50, "Max 50 characters"),
  description: z.string().max(500, "Max 500 characters").nullable().optional(),
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

export default function CategoryForm({ defaultValues, onSuccess, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [idTaken, setIdTaken] = useState(false);
  const isEdit = Boolean(defaultValues?.categoryid);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      categoryid: defaultValues?.categoryid ?? "",
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
    },
  });

  const checkIdExists = async (id) => {
    if (!id || isEdit) return;
    const { data } = await supabase
      .from("categories")
      .select("categoryid")
      .eq("categoryid", id)
      .maybeSingle();
    setIdTaken(Boolean(data));
  };

  const onFormSubmit = async (data) => {
    if (idTaken) return;
    setSaving(true);

    const payload = {
      categoryid: data.categoryid,
      name: data.name,
      description: data.description || null,
    };

    let error;
    if (isEdit) {
      ({ error } = await supabase
        .from("categories")
        .update({ name: payload.name, description: payload.description })
        .eq("categoryid", defaultValues.categoryid));
    } else {
      ({ error } = await supabase.from("categories").insert(payload));
    }

    setSaving(false);
    if (error) {
      toast.error("Failed to save category", { description: error.message });
    } else {
      toast.success(isEdit ? "Category updated" : "Category created");
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-4">
      <Field label="Category ID" required error={errors.categoryid}>
        <Input
          {...register("categoryid", {
            onChange: () => setIdTaken(false),
          })}
          placeholder="e.g. TOPS"
          disabled={isEdit}
          className={isEdit ? "bg-gray-100 cursor-not-allowed" : ""}
          onBlur={(e) => checkIdExists(e.target.value.trim())}
        />
        {idTaken && (
          <p className="text-xs text-red-500">
            ID "{getValues("categoryid")}" already exists — choose a different one.
          </p>
        )}
        {!idTaken && (
          <p className="text-xs text-muted-foreground">
            Uppercase letters and numbers, max 10 chars. Cannot be changed after creation.
          </p>
        )}
      </Field>

      <Field label="Name" required error={errors.name}>
        <Input {...register("name")} placeholder="e.g. Tops & Shirts" />
      </Field>

      <Field label="Description" error={errors.description}>
        <textarea
          {...register("description")}
          placeholder="Optional description…"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
        />
      </Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : isEdit ? "Update Category" : "Add Category"}
        </Button>
      </div>
    </form>
  );
}
