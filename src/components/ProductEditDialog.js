import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../components/ui/form";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "../components/hooks/use-toast";

const variantSchema = z.object({
  size: z.string().min(1, "Size is required"),
  color: z.string().min(1, "Color is required"),
  stock: z.coerce.number().nonnegative(),
});

const formSchema = z.object({
  name: z.string().min(1),
  categoryid: z.string().optional(),
  fabric: z.string().optional(),
  purchaseprice: z.coerce.number().nonnegative(),
  retailprice: z.coerce.number().nonnegative(),
  description: z.string().optional(),
  producturl: z.string().url().optional(),
  variants: z.array(variantSchema).optional(),
});

export default function ProductEditDialog({
  open,
  onClose,
  product,
  categories = [],
  variants = [],
  onSave,
}) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      categoryid: "",
      fabric: "",
      purchaseprice: 0,
      retailprice: 0,
      description: "",
      producturl: "",
      variants: [],
    },
  });

  const formatINR = (value) => {
    if (isNaN(value)) return "";
    return `₹${Number(value).toLocaleString("en-IN")}`;
  };

  useEffect(() => {
    if (product) {
      const mappedVariants = variants.map((variant) => ({
        size: variant.Size || variant.size || "",
        color: variant.Color || variant.color || "",
        stock: variant.Stock || variant.stock || 0,
      }));

      form.reset({
        ...product,
        variants: mappedVariants,
      });
    }
  }, [product, variants]);

  const handleSubmit = async (values) => {
    const { variants: updatedVariants = [] } = values;

    const seen = new Set();
    const duplicates = updatedVariants.some((variant) => {
      const key = `${variant.size}-${variant.color}`;
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });

    if (duplicates) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Cannot have duplicate size/color combinations",
      });
      return;
    }

    const updated = {
      ...product,
      ...values,
      variants: values.variants ?? [],
    };

    onClose();
    await onSave(updated);
  };

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variants",
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            {product?.productid && (
              <div className="text-sm font-medium text-gray-500">
                Product ID:{" "}
                <span className="font-semibold">{product.productid}</span>
              </div>
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="categoryid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <select
                        {...field}
                        className="w-full border rounded px-2 py-2 bg-white text-sm"
                      >
                        <option value="">Select Category</option>
                        {categories.map((cat) => (
                          <option key={cat.categoryid} value={cat.categoryid}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="fabric"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fabric</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="purchaseprice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Price</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        value={formatINR(field.value)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          field.onChange(Number(raw));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="retailprice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Retail Price</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        value={formatINR(field.value)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9]/g, "");
                          field.onChange(Number(raw));
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <textarea
                      {...field}
                      rows={4}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="producturl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Product URL</FormLabel>
                  <FormControl>
                    <Input type="url" {...field} />
                  </FormControl>
                  {field.value && (
                    <a
                      href={field.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 text-sm underline mt-1 inline-block"
                    >
                      Preview Link
                    </a>
                  )}
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <Label className="text-md">Variants</Label>
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-4 gap-2 items-end"
                >
                  <FormField
                    control={form.control}
                    name={`variants.${index}.size`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Size" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`variants.${index}.color`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Color" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Input
                    type="number"
                    placeholder="Stock"
                    {...form.register(`variants.${index}.stock`, {
                      valueAsNumber: true,
                    })}
                  />

                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => remove(index)}
                  >
                    Delete
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => append({ size: "", color: "", stock: 0 })}
              >
                + Add Variant
              </Button>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
