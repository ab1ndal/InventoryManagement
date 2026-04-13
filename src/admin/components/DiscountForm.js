// src/admin/components/DiscountForm.js
import { useState, useEffect, useRef } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../components/ui/select";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";

// ─── helpers ────────────────────────────────────────────────────────────────

const optionalNumeric = z.preprocess(
  (v) => (v === "" || v === null || v === undefined || isNaN(Number(v)) ? null : Number(v)),
  z.number().nonnegative("Must be ≥ 0").nullable()
);

const discountSchema = z
  .object({
    code: z.string().nullable().optional(),
    type: z.enum(
      [
        "flat",
        "percentage",
        "buy_x_get_y",
        "fixed_price",
        "conditional",
        "bundled_pricing",
      ],
      { required_error: "Type is required" },
    ),
    value: optionalNumeric,
    max_discount: optionalNumeric,
    // categories_selected replaces the old single-category text field
    categories_selected: z.array(z.string()).default([]),
    min_total: z
      .number({ invalid_type_error: "Must be a number" })
      .min(0, "Must be ≥ 0"),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    // rules sub-fields (assembled into JSONB on save)
    rules_buy_qty: optionalNumeric,
    rules_get_qty: optionalNumeric,
    rules_fixed_total: optionalNumeric,
    rules_FT_min_price: optionalNumeric,
    rules_FT_max_price: optionalNumeric,
    rules_bundle_qty: optionalNumeric,
    rules_bundle_price: optionalNumeric,
    // product_ids stored as comma-separated input, split on save
    product_ids_raw: z.string().optional(),
    once_per_customer: z.boolean().default(false),
    exclusive: z.boolean().default(false),
    auto_apply: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((d) => !d.start_date || !d.end_date || d.end_date >= d.start_date, {
    message: "End date must be on or after start date",
    path: ["end_date"],
  })
  .superRefine((d, ctx) => {
    if (d.type === "buy_x_get_y") {
      if (!d.rules_buy_qty || d.rules_buy_qty < 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required (min 1)",
          path: ["rules_buy_qty"],
        });
      if (!d.rules_get_qty || d.rules_get_qty < 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required (min 1)",
          path: ["rules_get_qty"],
        });
    }
    if (d.type === "fixed_price") {
      if (d.rules_fixed_total === null || d.rules_fixed_total === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required",
          path: ["rules_fixed_total"],
        });
    }
    if (d.type === "bundled_pricing") {
      if (!d.rules_bundle_qty || d.rules_bundle_qty < 1)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required (min 1)",
          path: ["rules_bundle_qty"],
        });
      if (d.rules_bundle_price === null || d.rules_bundle_price === undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required",
          path: ["rules_bundle_price"],
        });
    }
  });

const TYPE_LABELS = {
  flat: "Flat Amount (₹)",
  percentage: "Percentage (%)",
  buy_x_get_y: "Buy X Get Y (Free items)",
  fixed_price: "Fixed Price",
  conditional: "Conditional (min spend)",
  bundled_pricing: "Bundled Pricing",
};

// Types that use the top-level value field
const USES_VALUE = new Set(["flat", "percentage", "conditional"]);
// Types that use the category multi-select
const USES_CATEGORIES = new Set(["buy_x_get_y", "fixed_price", "bundled_pricing"]);

function FieldError({ error }) {
  if (!error) return null;
  return <p className="text-xs text-red-500 mt-1">{error.message}</p>;
}

function Field({ label, required, optional, children, error }) {
  return (
    <div className="space-y-1">
      <Label>
        {label} {required && <span className="text-red-500">*</span>}
        {optional && (
          <span className="text-muted-foreground text-xs ml-1">(optional)</span>
        )}
      </Label>
      {children}
      <FieldError error={error} />
    </div>
  );
}

// ─── Multi-category dropdown ─────────────────────────────────────────────────

function CategoryMultiSelect({ value = [], onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (name) => {
    if (value.includes(name)) onChange(value.filter((v) => v !== name));
    else onChange([...value, name]);
  };

  const displayLabel =
    value.length === 0
      ? "All categories"
      : value.length === 1
        ? value[0]
        : `${value.length} categories selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <span className={value.length === 0 ? "text-muted-foreground" : ""}>
          {displayLabel}
        </span>
        <svg
          className="ml-2 h-4 w-4 shrink-0 opacity-50"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-md max-h-52 overflow-y-auto">
          {options.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              No categories found
            </p>
          )}
          {options.map((name) => (
            <label
              key={name}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent text-sm"
            >
              <Checkbox
                checked={value.includes(name)}
                onCheckedChange={() => toggle(name)}
              />
              <span>{name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── helpers to populate defaultValues from a saved discount ─────────────────
function toFormValues(d) {
  // Resolve categories: prefer rules.categories array, fall back to single d.category
  const categoriesSelected =
    d.rules?.categories && d.rules.categories.length > 0
      ? d.rules.categories
      : d.category
        ? [d.category]
        : [];
  return {
    code: d.code ?? "",
    type: d.type ?? "flat",
    value: d.value ?? 0,
    max_discount: d.max_discount ?? null,
    categories_selected: categoriesSelected,
    min_total: d.min_total ?? 0,
    start_date: d.start_date ? d.start_date.slice(0, 10) : "",
    end_date: d.end_date ? d.end_date.slice(0, 10) : "",
    rules_buy_qty: d.rules?.buy_qty ?? null,
    rules_get_qty: d.rules?.get_qty ?? null,
    rules_fixed_total: d.rules?.fixed_total ?? null,
    rules_FT_min_price: d.rules?.min_price ?? null,
    rules_FT_max_price: d.rules?.max_price ?? null,
    rules_bundle_qty: d.rules?.bundle_qty ?? null,
    rules_bundle_price: d.rules?.bundle_price ?? null,
    product_ids_raw: (d.product_ids ?? []).join(", "),
    once_per_customer: d.once_per_customer ?? false,
    exclusive: d.exclusive ?? false,
    auto_apply: d.auto_apply ?? false,
    active: d.active ?? true,
  };
}

const EMPTY_DEFAULTS = {
  code: "",
  type: "flat",
  value: 0,
  max_discount: null,
  categories_selected: [],
  min_total: 0,
  start_date: "",
  end_date: "",
  rules_buy_qty: null,
  rules_get_qty: null,
  rules_fixed_total: null,
  rules_FT_min_price: null,
  rules_FT_max_price: null,
  rules_bundle_qty: null,
  rules_bundle_price: null,
  product_ids_raw: "",
  once_per_customer: false,
  exclusive: false,
  auto_apply: false,
  active: true,
};

// ─── component ───────────────────────────────────────────────────────────────

export default function DiscountForm({ defaultValues, onSuccess, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState([]);

  // Fetch available categories for the multi-select dropdown
  useEffect(() => {
    supabase
      .from("categories")
      .select("name")
      .order("name")
      .then(({ data }) => {
        setCategoryOptions((data || []).map((c) => c.name));
      });
  }, []);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(discountSchema),
    defaultValues: defaultValues ? toFormValues(defaultValues) : EMPTY_DEFAULTS,
  });

  const type = useWatch({ control, name: "type" });

  const onFormSubmit = async (data) => {
    setSaving(true);

    const cats = data.categories_selected || [];

    // Assemble rules JSONB based on type
    let rules = null;
    if (data.type === "buy_x_get_y") {
      rules = {
        buy_qty: data.rules_buy_qty,
        get_qty: data.rules_get_qty,
        ...(cats.length > 0 ? { categories: cats, category: cats[0] } : {}),
      };
    } else if (data.type === "fixed_price") {
      rules = {
        fixed_total: data.rules_fixed_total,
        ...(data.rules_FT_min_price != null ? { min_price: data.rules_FT_min_price } : {}),
        ...(data.rules_FT_max_price != null ? { max_price: data.rules_FT_max_price } : {}),
        ...(cats.length > 0 ? { categories: cats, category: cats[0] } : {}),
      };
    } else if (data.type === "bundled_pricing") {
      rules = {
        bundle_qty: data.rules_bundle_qty,
        bundle_price: data.rules_bundle_price,
        ...(cats.length > 0 ? { categories: cats, category: cats[0] } : {}),
      };
    }

    // Parse product_ids from comma-separated string
    const product_ids = (data.product_ids_raw || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const payload = {
      code: data.code || null,
      type: data.type,
      value: data.value ?? null,
      max_discount: data.max_discount ?? null,
      // Store first selected category in top-level column for backward compat
      category: cats[0] || null,
      min_total: data.min_total,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      rules,
      product_ids: product_ids.length ? product_ids : null,
      once_per_customer: data.once_per_customer ?? false,
      exclusive: data.exclusive ?? false,
      auto_apply: data.auto_apply ?? false,
      active: data.active ?? true,
    };

    let error;
    if (defaultValues?.id) {
      ({ error } = await supabase
        .from("discounts")
        .update(payload)
        .eq("id", defaultValues.id));
    } else {
      ({ error } = await supabase.from("discounts").insert(payload));
    }

    setSaving(false);
    if (error) {
      toast.error("Failed to save discount", { description: error.message });
    } else {
      toast.success(
        defaultValues?.id ? "Discount updated" : "Discount created",
      );
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-5">
      {/* Code + Type */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Code" optional error={errors.code}>
          <Input {...register("code")} placeholder="e.g. WELCOME100" />
        </Field>

        <Field label="Type" required error={errors.type}>
          <Controller
            name="type"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      {/* Value + Max Discount — value hidden for types that use rules instead */}
      <div className={`gap-4 ${USES_VALUE.has(type) ? "grid grid-cols-2" : "flex"}`}>
        {USES_VALUE.has(type) && (
          <Field
            label={
              type === "percentage"
                ? "Value (%)"
                : type === "conditional"
                  ? "Discount Amount (₹ off)"
                  : "Value (₹)"
            }
            required
            error={errors.value}
          >
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="0"
              {...register("value", { valueAsNumber: true })}
            />
          </Field>
        )}
        <Field
          label="Max Discount (₹)"
          optional
          error={errors.max_discount}
          className={USES_VALUE.has(type) ? "" : "w-full"}
        >
          <Input
            type="number"
            min={0}
            step="any"
            placeholder="No cap"
            {...register("max_discount", { valueAsNumber: true })}
          />
        </Field>
      </div>

      {/* Min Order Total */}
      <Field label="Min Order Total (₹)" required error={errors.min_total}>
        <Input
          type="number"
          min={0}
          step="any"
          {...register("min_total", { valueAsNumber: true })}
        />
      </Field>

      {/* Category multi-select — shown for types that filter by category */}
      {USES_CATEGORIES.has(type) && (
        <Field
          label="Categories"
          optional
          error={errors.categories_selected}
        >
          <Controller
            name="categories_selected"
            control={control}
            render={({ field }) => (
              <CategoryMultiSelect
                value={field.value}
                onChange={field.onChange}
                options={categoryOptions}
              />
            )}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Leave blank to apply to all categories.
          </p>
        </Field>
      )}

      {/* Rules — Buy X Get Y */}
      {type === "buy_x_get_y" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">
            Buy X Get Y Rules
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Buy Quantity" required error={errors.rules_buy_qty}>
              <Input
                type="number"
                min={1}
                placeholder="e.g. 2"
                {...register("rules_buy_qty", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Get Quantity (free)"
              required
              error={errors.rules_get_qty}
            >
              <Input
                type="number"
                min={1}
                placeholder="e.g. 1"
                {...register("rules_get_qty", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <p className="text-xs text-blue-700">
            The cheapest qualifying item unit(s) are given free. Use the
            Categories field above to restrict which items qualify.
          </p>
        </div>
      )}

      {/* Rules — Fixed Price */}
      {type === "fixed_price" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">
            Fixed Price Rules
          </p>
          <Field
            label="Fixed Price Per Item (₹)"
            required
            error={errors.rules_fixed_total}
          >
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="e.g. 499"
              {...register("rules_fixed_total", { valueAsNumber: true })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Min Item MRP (₹)"
              optional
              error={errors.rules_FT_min_price}
            >
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="No lower bound"
                {...register("rules_FT_min_price", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Max Item MRP (₹)"
              optional
              error={errors.rules_FT_max_price}
            >
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="No upper bound"
                {...register("rules_FT_max_price", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <p className="text-xs text-blue-700">
            Each qualifying item (in selected categories, with MRP in the
            specified range) is repriced to the fixed price per item. Items
            already cheaper than the fixed price are not affected.
          </p>
        </div>
      )}

      {/* Rules — Bundled Pricing */}
      {type === "bundled_pricing" && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-800">
            Bundle Rules
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Bundle Quantity"
              required
              error={errors.rules_bundle_qty}
            >
              <Input
                type="number"
                min={1}
                placeholder="e.g. 3"
                {...register("rules_bundle_qty", { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Bundle Price (₹)"
              required
              error={errors.rules_bundle_price}
            >
              <Input
                type="number"
                min={0}
                step="any"
                placeholder="e.g. 999"
                {...register("rules_bundle_price", { valueAsNumber: true })}
              />
            </Field>
          </div>
          <p className="text-xs text-blue-700">
            Customer gets <strong>Bundle Qty</strong> items from the selected
            categories for a total of <strong>Bundle Price</strong>. The
            cheapest qualifying items are used to form the bundle.
          </p>
        </div>
      )}

      {/* Start + End Date */}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start Date" optional error={errors.start_date}>
          <Input type="date" {...register("start_date")} />
        </Field>
        <Field label="End Date" optional error={errors.end_date}>
          <Input type="date" {...register("end_date")} />
        </Field>
      </div>

      {/* Product IDs */}
      <Field label="Product IDs" optional error={errors.product_ids_raw}>
        <Input
          {...register("product_ids_raw")}
          placeholder="BC25001, BC25002, BC25003"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Comma-separated product IDs to restrict this discount to specific
          products.
        </p>
      </Field>

      {/* Checkboxes */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        {[
          { name: "auto_apply", label: "Auto-apply at checkout" },
          { name: "exclusive", label: "Exclusive (can't stack)" },
          { name: "once_per_customer", label: "Once per customer" },
          { name: "active", label: "Active" },
        ].map(({ name, label }) => (
          <Controller
            key={name}
            name={name}
            control={control}
            render={({ field }) => (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <span className="text-sm">{label}</span>
              </label>
            )}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving
            ? "Saving…"
            : defaultValues?.id
              ? "Update Discount"
              : "Add Discount"}
        </Button>
      </div>
    </form>
  );
}
