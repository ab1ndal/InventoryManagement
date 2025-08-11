// src/admin/components/DiscountForm.js
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { format } from "date-fns";

const discountSchema = z.object({
  id: z.number().optional(),
  code: z.string().nullable(),
  type: z.enum([
    "flat",
    "percentage",
    "buy_x_get_y",
    "fixed_price",
    "conditional",
  ]),
  value: z.number().nonnegative(),
  max_discount: z.number().nullable().optional(),
  category: z.string().nullable().optional(),
  product_ids: z.array(z.string()).optional(),
  once_per_customer: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  auto_apply: z.boolean().optional(),
  min_total: z.number().min(0),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export default function DiscountForm({ defaultValues, onSubmit, onCancel }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(discountSchema),
    defaultValues: defaultValues || {
      type: "flat",
      value: 0,
      min_total: 0,
      active: true,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid grid-cols-2 gap-4">
      <Input
        label="Code"
        {...register("code")}
        placeholder="WEL100 or leave blank"
      />
      <Input
        label="Type"
        {...register("type")}
        placeholder="flat / percentage"
      />
      <Input
        label="Value"
        type="number"
        {...register("value", { valueAsNumber: true })}
      />
      <Input
        label="Max Discount"
        type="number"
        {...register("max_discount", { valueAsNumber: true })}
      />
      <Input label="Category" {...register("category")} />
      <Input
        label="Min Total"
        type="number"
        {...register("min_total", { valueAsNumber: true })}
      />
      <Input label="Start Date" type="date" {...register("start_date")} />
      <Input label="End Date" type="date" {...register("end_date")} />

      <label className="flex items-center gap-2">
        <Checkbox {...register("once_per_customer")} /> Once per customer
      </label>
      <label className="flex items-center gap-2">
        <Checkbox {...register("exclusive")} /> Exclusive
      </label>
      <label className="flex items-center gap-2">
        <Checkbox {...register("auto_apply")} /> Auto Apply
      </label>
      <label className="flex items-center gap-2">
        <Checkbox {...register("active")} /> Active
      </label>

      <div className="col-span-2 flex gap-2 mt-4">
        <Button type="submit">Save</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}