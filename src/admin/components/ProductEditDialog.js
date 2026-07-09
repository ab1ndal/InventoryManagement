import React, { useEffect, useState } from "react";
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
//import { toast } from "../../components/hooks/use-toast";
import CustomDropdown from "../../components/CustomDropdown";
import AddSizeDialog from "./AddSizeDialog";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { formatINR } from "../../utility/formatCurrency";
import { encodePriceToZCode, decodeZCodeToPrice } from "../../utility/zCode";
import { sortVariantsBySizeColor } from "../../utility/sortVariants";
import {
  composeProductName,
  shouldRecomposeName,
} from "../../utility/productName";

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
  unit_type: z.enum(["piece", "meter"]).default("piece"),
  variants: z.array(variantSchema).optional(),
});

export default function ProductEditDialog({
  open,
  onClose,
  product,
  categories = [],
  variants = [],
  onSave,
  isSuperAdmin = false,
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
      unit_type: "piece",
      variants: [],
    },
  });

  const originalVariantsRef = React.useRef([]);
  const originalNamePartsRef = React.useRef({ fabric: "", categoryid: "" });

  // Size is a controlled vocabulary (FK to `sizes` lookup) — options come from
  // the DB, never free text. Empty list on fetch failure keeps entry blocked
  // rather than degrading to a text input. New codes enter only through the
  // deliberate add-new flow (AddSizeDialog).
  const [sizes, setSizes] = useState([]);
  // { code, onSelect } while the add-new dialog is open, null otherwise
  const [addSize, setAddSize] = useState(null);

  const fetchSizes = React.useCallback(async () => {
    const { data, error } = await supabase
      .from("sizes")
      .select("code, label, size_type, sort_order")
      .order("sort_order");
    if (error) {
      console.error("Failed to load size options:", error.message);
      return;
    }
    setSizes(data || []);
  }, []);

  useEffect(() => {
    if (open) fetchSizes();
  }, [open, fetchSizes]);

  const sizeOptions = sizes.map((s) => ({ value: s.code, label: s.label }));

  useEffect(() => {
    if (product) {
      hasEditedNameRef.current = false; // Reset manual edit tracking
      const mappedVariants = sortVariantsBySizeColor(variants).map((variant) => ({
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
      originalNamePartsRef.current = {
        fabric: product.fabric || "",
        categoryid: product.categoryid || "",
      };
    }
  }, [form, product, variants]);

  // Recompose the (hidden) name field from fabric + category, but only when it
  // should change — for an existing product that means fabric/category were
  // actually edited. Prevents a stray blur from silently renaming the product.
  const maybeComposeName = () => {
    const fabric = form.getValues("fabric") || "";
    const categoryid = form.getValues("categoryid") || "";
    const recompose = shouldRecomposeName({
      isNewProduct: !product?.productid,
      fabricChanged: fabric !== originalNamePartsRef.current.fabric,
      categoryChanged: categoryid !== originalNamePartsRef.current.categoryid,
    });
    if (!recompose) return;
    const categoryName =
      categories.find((c) => c.categoryid === categoryid)?.name || "";
    form.setValue("name", composeProductName(fabric, categoryName));
  };

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

  const watchedUnitType = form.watch("unit_type");
  const isMeter = watchedUnitType === "meter";

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
                          maybeComposeName();
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
                          maybeComposeName();
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
                render={({ field }) =>
                  isSuperAdmin ? (
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
                  ) : (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Product Z Code</FormLabel>
                        <span className="text-xs text-transparent">Auto</span>
                      </div>
                      <FormControl>
                        <Input
                          type="text"
                          value={encodePriceToZCode(field.value)}
                          onChange={(e) => {
                            const raw = e.target.value
                              .toUpperCase()
                              .replace(/[^A-IZ]/g, "");
                            field.onChange(decodeZCodeToPrice(raw));
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )
                }
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
            <FormField
              control={form.control}
              name="unit_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit Type</FormLabel>
                  <FormControl>
                    <div className="flex rounded-md border overflow-hidden w-fit">
                      <button
                        type="button"
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                          field.value === "piece"
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted"
                        }`}
                        onClick={() => field.onChange("piece")}
                      >
                        Piece
                      </button>
                      <button
                        type="button"
                        className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                          field.value === "meter"
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted"
                        }`}
                        onClick={() => field.onChange("meter")}
                      >
                        Meter
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
              <div className="flex items-center justify-between">
                <Label className="text-md">Variants</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                        ? "FREE-SIZE"
                        : "",
                      color: "",
                      stock: 0,
                    });
                  }}
                >
                  <Plus />
                  Add Variant
                </Button>
              </div>
              {fields.map((field, index) => {
                const stockValue = form.watch(`variants.${index}.stock`);
                const isDepleted = (Number(stockValue) || 0) === 0;
                // Depleted rows are dimmed for scanability, but the dim is applied
                // per-cell — NOT on the row — so an open Size dropdown (which lives
                // inside the size cell) stays fully opaque. CSS `opacity` on an
                // ancestor would composite the whole popover subtree at 50%.
                const dim = isDepleted ? "opacity-50" : undefined;
                return (
                <div
                  key={field.id}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_2.25rem] gap-2 items-end"
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
                          <CustomDropdown
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            options={sizeOptions}
                            placeholder="Size"
                            onAddNew={(term) =>
                              setAddSize({ code: term, onSelect: field.onChange })
                            }
                          />
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
                          <Input placeholder="Color" {...field} className={dim} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Input
                    type="number"
                    placeholder={isMeter ? "Stock (m)" : "Stock"}
                    step={isMeter ? "0.001" : "1"}
                    min="0"
                    className={dim}
                    {...form.register(`variants.${index}.stock`, {
                      valueAsNumber: true,
                    })}
                  />

                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Delete variant"
                    onClick={() => remove(index)}
                    className={`text-destructive hover:bg-destructive/10 hover:text-destructive${
                      isDepleted ? " opacity-50" : ""
                    }`}
                  >
                    <Trash2 />
                  </Button>
                </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </Form>

        <AddSizeDialog
          open={!!addSize}
          initialCode={addSize?.code || ""}
          existingSizes={sizes}
          onClose={() => setAddSize(null)}
          onAdded={async (newCode) => {
            await fetchSizes();
            addSize?.onSelect(newCode);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
