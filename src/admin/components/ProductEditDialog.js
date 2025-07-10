import React, { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../../components/ui/form";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "../../components/hooks/use-toast";
import CustomDropdown from "../../components/CustomDropdown";

const variantSchema = z.object({
  variantid: z.string().optional(),
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

  const originalVariantsRef = React.useRef([]);

  useEffect(() => {
    if (product) {
      hasEditedNameRef.current = false; // Reset manual edit tracking
      const mappedVariants = variants.map((variant) => ({
        variantid: variant.variantid || undefined,
        size: variant.size || "",
        color: variant.color || "",
        stock: variant.stock || 0,
      }));

      form.reset({
        ...product,
        variants: mappedVariants,
      });
      originalVariantsRef.current = mappedVariants;
    }
  }, [form, product, variants]);

  const handleSubmit = async (values) => {
    const updatedVariants = values.variants ?? [];

    const getKey = (v) => v.variantid;
    const originalKeys = new Set(
      originalVariantsRef.current.map((v) => getKey(v))
    );
    const updatedKeys = new Set(updatedVariants.map((v) => getKey(v)));

    const deletedVariants = [...originalKeys]
      .filter((k) => k && !updatedKeys.has(k))
      .map((variantid) => ({ variantid }));

    const updated = {
      ...product,
      ...values,
      variants: (updatedVariants ?? []).map((v) => ({
        ...v,
        productid: product.productid,
      })),
    };

    onClose();
    await onSave(updated, deletedVariants);
  };

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "variants",
  });

  const hasEditedNameRef = React.useRef(false);

  useEffect(() => {
    const subscription = form.watch((_, { name: changedField }) => {
      if (changedField === "name") {
        hasEditedNameRef.current = true;
      }
    });
    return () => subscription.unsubscribe();
  }, [form]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {product?.productid ? "Edit Product" : "Add Product"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            {product?.productid && (
              <div className="flex items-center justify-between text-sm font-medium text-gray-500">
                <span>
                  Product ID:{" "}
                  <span className="font-semibold">{product.productid}</span>
                </span>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 items-end">
              <FormField
                control={form.control}
                name="categoryid"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <CustomDropdown
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={(e) => {
                          field.onBlur?.(e); // preserve default blur behavior
                          const categoryName =
                            categories.find(
                              (c) =>
                                c.categoryid === form.getValues("categoryid")
                            )?.name || "";
                          const composedName = [
                            form.getValues("fabric"),
                            categoryName,
                          ]
                            .filter(Boolean)
                            .join(" - ");
                          form.setValue("name", composedName);
                        }}
                        options={[...categories]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((cat) => ({
                            value: cat.categoryid,
                            label: cat.name,
                          }))}
                        placeholder="Select Category"
                      />
                    </FormControl>
                    <FormMessage />
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
                      <Input
                        {...field}
                        onBlur={(e) => {
                          field.onBlur?.(e); // preserve default blur behavior
                          const categoryName =
                            categories.find(
                              (c) =>
                                c.categoryid === form.getValues("categoryid")
                            )?.name || "";
                          const composedName = [
                            form.getValues("fabric"),
                            categoryName,
                          ]
                            .filter(Boolean)
                            .join(" - ");
                          form.setValue("name", composedName);
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {!product?.productid && (
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={onClose}>
                    Close
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              )}
            </div>

            {/* Name field in its own row */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <div className="hidden">
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                </div>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="purchaseprice"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Purchase Price</FormLabel>
                      {/* Empty space to align with Auto button */}
                      <span className="text-xs text-transparent">Auto</span>
                    </div>
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
                    {/* Label + Auto button */}
                    <div className="flex items-center justify-between">
                      <FormLabel>Retail Price</FormLabel>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        className="text-xs text-blue-600 hover:underline px-1 py-0"
                        onClick={() => {
                          const purchase = form.getValues("purchaseprice") || 0;
                          const retail = Math.ceil(purchase * 2.5);
                          form.setValue("retailprice", retail);
                        }}
                      >
                        Auto
                      </Button>
                    </div>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div className="md:col-span-2">
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={8}
                          className="w-full h-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="md:col-span-1">
                {form.getValues("producturl") && (
                  <div>
                    <Label>Product Image</Label>
                    <div className="mt-2 border rounded-md p-2 bg-muted w-fit">
                      <img
                        src={`${form.getValues(
                          "producturl"
                        )}/display/image.jpg`}
                        alt="Product Preview"
                        className="max-h-48 object-contain rounded"
                        onError={(e) => {
                          e.target.replaceWith(
                            Object.assign(document.createElement("div"), {
                              innerText: "No image found",
                              className: "text-sm text-muted-foreground italic",
                            })
                          );
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

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
                  <input
                    type="hidden"
                    {...form.register(`variants.${index}.variantid`)}
                  />
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
                onClick={() => {
                  const selectedCategoryId = form.getValues("categoryid");
                  const selectedCategory = categories.find(
                    (c) => c.categoryid === selectedCategoryId
                  );
                  const categoryName =
                    selectedCategory?.name?.toLowerCase() || "";

                  const presetCategories = ["saree"]; // lowercased for case-insensitive match

                  append({
                    variantid: crypto.randomUUID(),
                    size: presetCategories.includes(categoryName)
                      ? "Free-Size"
                      : "",
                    color: "",
                    stock: 0,
                  });
                }}
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
