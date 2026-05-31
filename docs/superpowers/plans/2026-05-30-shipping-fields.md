# Shipping Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HSN codes and physical dimensions (weight, L×W×H) to categories and products so the storefront can pass correct shipping data to courier APIs, with category-level defaults covering all 3000+ existing products immediately.

**Architecture:** Two DB migrations add nullable columns to `categories` (hsn_code, default_weight_grams) and `products` (weight_override_grams, length_cm, width_cm, height_cm). A `shippingUtils.js` utility resolves effective weight (product override → category default → null). CategoryTable's inline edit, CategoryForm, and ProductEditDialog are updated to expose these fields.

**Tech Stack:** React 19, Supabase (PostgreSQL), React Hook Form + Zod, Shadcn/ui, Vitest.

---

## Category Reference: HSN Codes + Default Weights

HSN codes follow India GST Chapter 61 (knitted) and 62 (woven). Weights are shipping estimates in grams — override per product as needed.

| Category ID | Name | HSN Code | Default Weight (g) | Notes |
|-------------|------|----------|--------------------|-------|
| C-S3P | 3 Pc Suit (Child) | 62034900 | 500 | Boys' woven 3-pc |
| C-S5P | 5 Pc Suit (Child) | 62034900 | 700 | Boys' woven 5-pc |
| ACC | Accessories/Others | 62179090 | 150 | Safa, Mala, misc |
| BLZ | Blazer | 62031900 | 600 | Men's woven jacket |
| CRD | Cord Sets | 62114290 | 350 | Women's coord set |
| DRS | Dress | 62044900 | 400 | Women's dress |
| DPT | Dupatta | 62149090 | 150 | Scarf/long drape |
| FAB-R | Fabric - Raymond | 52111190 | 1000 | Per piece; weight varies |
| FAB-S | Fabric - Siyaram | 52111190 | 1000 | Per piece; weight varies |
| FAB-V | Fabric - Vimal | 52111190 | 1000 | Per piece; weight varies |
| FRMP | Formal Pant | 62034100 | 400 | Men's woven trousers |
| GD | Gents Dhoti | 62114290 | 300 | Traditional lower |
| GMala | Gents Mala | 62179090 | 100 | Wedding neckwear |
| GSFa | Gents Safa | 62179090 | 200 | Turban/headgear |
| GWN | Gown | 62044900 | 600 | Women's long formal |
| IH | Indo Harem | 62114290 | 300 | Drop-crotch fusion |
| IP | Indo Pant | 62114290 | 300 | Fusion pants |
| IW | Indo-Western | 62114290 | 700 | Full fusion set |
| C-IW | Indo-Western (Child) | 62034900 | 500 | Boys' fusion set |
| JNS | Jeans | 62034200 | 500 | Denim trousers |
| JDA | Joda | 62114290 | 800 | Pant+shirt/suit length |
| KP | Kurta Pajama | 62114290 | 500 | Men's traditional set |
| C-KP | Kurta-Pajama (Child) | 62114290 | 350 | Boys' traditional set |
| KUR | Kurti | 62114290 | 300 | Women's tunic |
| LCH | Lachha | 62044900 | 600 | Layered wedding dress |
| LG | Legging | 61130090 | 200 | Knitted stretch pants |
| LE | Lehenga | 62044900 | 800 | Skirt + blouse + dupatta |
| NHJ | Nehru Jacket | 62031900 | 500 | Mandarin collar jacket |
| PNT | Pant | 62034100 | 400 | Generic western trouser |
| J-PS | Pant-Shirt Joda | 62114290 | 700 | Matching pant+shirt set |
| PL | Plazo | 62044900 | 300 | Wide-leg women's trousers |
| RMS | Readymade Suits | 62114290 | 600 | Women's salwar suit set |
| J-SF | Safari Joda | 62114290 | 700 | Safari-style 2-pc |
| SA | Saree | 62114290 | 600 | Draped traditional |
| SHR | Sharara | 62044900 | 400 | Wide-leg with kurta |
| SHWL | Shawl | 62141090 | 400 | Woolen/silk wrap |
| SW | Sherwani | 62031900 | 1000 | Men's long coat |
| C-SW | Sherwani (Child) | 62034900 | 700 | Boys' long coat |
| SHT | Shirt | 62052090 | 300 | Men's cotton shirt |
| SK | Short Kurta | 62114290 | 250 | Short tunic |
| SKT-TOP | Skirt-Crop Top | 62114290 | 350 | Indo-Western fusion |
| S2P | Suit (2 Pc) | 62031900 | 800 | Men's 2-pc formal |
| S3P | Suit (3 Pc) | 62031900 | 1000 | Men's 3-pc with vest |
| S5P | Suit (5 Pc) | 62031900 | 1200 | Men's 5-pc with shirt+tie |
| SJ-2P | Suit (Jodhpuri) - 2Pc | 62031900 | 900 | Jodhpuri embroidered 2-pc |
| SJ-3P | Suit (Jodhpuri) - 3Pc | 62031900 | 1100 | Jodhpuri embroidered 3-pc |
| J-S | Suit Joda | 52111190 | 600 | Fabric set for tailoring |
| ST | Suits | 62114290 | 700 | General kurta+bottom set |
| SWT-SHT | Sweatshirt | 61102090 | 400 | Knitted pullover |
| T-SHT | T-Shirt | 61091090 | 200 | Knitted crew/v-neck |
| TOP | Tops | 62064090 | 250 | Women's casual upper |
| TRS | Trousers | 62034100 | 400 | Formal/semi-formal pants |

**HSN Chapter Reference:**
- `6109` — T-shirts, knitted/crocheted
- `6110` — Jerseys/sweatshirts, knitted
- `6113` — Knitted/crocheted garments (leggings etc.)
- `6203` — Men's woven suits/jackets/trousers
- `6204` — Women's woven suits/dresses/skirts
- `6205` — Men's woven shirts
- `6206` — Women's woven blouses
- `6211` — Other woven garments (kurtas, indo-western, sarees)
- `6214` — Shawls, scarves, dupattas
- `6217` — Other clothing accessories (mala, safa)
- `5211` — Woven cotton fabric (for fabric categories)

**Weights to verify with supplier bills** — fabric categories especially variable. Child sizes ~30% lighter than adult equivalent.

---

## File Map

| Action | File |
|--------|------|
| Create | `schema/migration_shipping_fields.sql` |
| Create | `src/utility/shippingUtils.js` |
| Create | `src/utility/__tests__/shippingUtils.test.js` |
| Modify | `src/admin/components/CategoryForm.js` |
| Modify | `src/admin/components/CategoryTable.js` |
| Modify | `src/admin/components/ProductEditDialog.js` |

---

## Task 1: DB Migration

**Files:**
- Create: `schema/migration_shipping_fields.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- Migration: Shipping fields for categories and products
-- Run in Supabase dashboard SQL editor

-- 1. Add shipping defaults to categories
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS hsn_code            varchar(10),
  ADD COLUMN IF NOT EXISTS default_weight_grams integer;

-- 2. Add shipping overrides/dimensions to products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_override_grams integer,
  ADD COLUMN IF NOT EXISTS length_cm             numeric(8,2),
  ADD COLUMN IF NOT EXISTS width_cm              numeric(8,2),
  ADD COLUMN IF NOT EXISTS height_cm             numeric(8,2);
```

- [ ] **Step 2: Run in Supabase SQL editor and confirm no errors**

- [ ] **Step 3: Commit**

```bash
git add schema/migration_shipping_fields.sql
git commit -m "feat: shipping fields — DB migration"
```

---

## Task 2: Shipping Utility (TDD)

**Files:**
- Create: `src/utility/shippingUtils.js`
- Create: `src/utility/__tests__/shippingUtils.test.js`

- [ ] **Step 1: Write failing tests**

```js
// src/utility/__tests__/shippingUtils.test.js
import { resolveEffectiveWeight } from "../shippingUtils";

describe("resolveEffectiveWeight", () => {
  it("returns product override when set", () => {
    const product = { weight_override_grams: 150 };
    const category = { default_weight_grams: 200 };
    expect(resolveEffectiveWeight(product, category)).toBe(150);
  });

  it("falls back to category default when no product override", () => {
    const product = { weight_override_grams: null };
    const category = { default_weight_grams: 200 };
    expect(resolveEffectiveWeight(product, category)).toBe(200);
  });

  it("returns null when neither is set", () => {
    const product = { weight_override_grams: null };
    const category = { default_weight_grams: null };
    expect(resolveEffectiveWeight(product, category)).toBeNull();
  });

  it("returns null when category is not found", () => {
    const product = { weight_override_grams: null };
    expect(resolveEffectiveWeight(product, null)).toBeNull();
  });

  it("uses override of 0 as valid (not falsy fallback)", () => {
    // 0g is unusual but explicitly set — respect it
    const product = { weight_override_grams: 0 };
    const category = { default_weight_grams: 200 };
    // 0 means "unset" in practice; treat null/undefined as unset, 0 as valid
    expect(resolveEffectiveWeight(product, category)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm FAIL**

```bash
npm test -- --testPathPattern=shippingUtils
```
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement utility**

```js
// src/utility/shippingUtils.js

/**
 * Resolves the effective shipping weight for a product.
 * Product override takes precedence over category default.
 * Returns null if neither is set.
 *
 * @param {object} product - has weight_override_grams (int|null)
 * @param {object|null} category - has default_weight_grams (int|null)
 * @returns {number|null}
 */
export function resolveEffectiveWeight(product, category) {
  if (product?.weight_override_grams != null) return product.weight_override_grams;
  if (category?.default_weight_grams != null) return category.default_weight_grams;
  return null;
}
```

- [ ] **Step 4: Run to confirm PASS**

```bash
npm test -- --testPathPattern=shippingUtils
```
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/utility/shippingUtils.js src/utility/__tests__/shippingUtils.test.js
git commit -m "feat: shippingUtils — effective weight resolver with tests"
```

---

## Task 3: CategoryForm — HSN Code + Default Weight

**Files:**
- Modify: `src/admin/components/CategoryForm.js`

- [ ] **Step 1: Update Zod schema** — add hsn_code and default_weight_grams

Replace `categorySchema` with:

```js
const categorySchema = z.object({
  categoryid: z
    .string()
    .min(1, "Required")
    .max(10, "Max 10 characters")
    .regex(/^[A-Z0-9]+$/, "Uppercase letters and numbers only"),
  name: z.string().min(1, "Required").max(50, "Max 50 characters"),
  description: z.string().max(500, "Max 500 characters").nullable().optional(),
  hsn_code: z
    .string()
    .max(10, "Max 10 characters")
    .regex(/^[0-9]*$/, "Digits only")
    .optional()
    .transform((v) => (v?.trim() === "" ? null : v ?? null)),
  default_weight_grams: z.coerce
    .number({ invalid_type_error: "Must be a number" })
    .int("Must be a whole number")
    .nonnegative("Must be 0 or more")
    .optional()
    .nullable()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});
```

- [ ] **Step 2: Update form defaultValues**

In `useForm` defaultValues:

```js
defaultValues: {
  categoryid: defaultValues?.categoryid ?? "",
  name: defaultValues?.name ?? "",
  description: defaultValues?.description ?? "",
  hsn_code: defaultValues?.hsn_code ?? "",
  default_weight_grams: defaultValues?.default_weight_grams ?? "",
},
```

- [ ] **Step 3: Update payload in onFormSubmit**

```js
const payload = {
  categoryid: data.categoryid,
  name: data.name,
  description: data.description || null,
  hsn_code: data.hsn_code ?? null,
  default_weight_grams: data.default_weight_grams ?? null,
};
```

For edit, also include new fields in the update call:

```js
({ error } = await supabase
  .from("categories")
  .update({
    name: payload.name,
    description: payload.description,
    hsn_code: payload.hsn_code,
    default_weight_grams: payload.default_weight_grams,
  })
  .eq("categoryid", defaultValues.categoryid));
```

- [ ] **Step 4: Add fields to JSX** — after Description field and before the button row

```jsx
<div className="grid grid-cols-2 gap-4">
  <Field label="HSN Code" error={errors.hsn_code}>
    <Input
      {...register("hsn_code")}
      placeholder="e.g. 620590"
      maxLength={10}
    />
    <p className="text-xs text-muted-foreground mt-1">
      From supplier bill — e.g. 620590 for shirts
    </p>
  </Field>

  <Field label="Default Weight (grams)" error={errors.default_weight_grams}>
    <Input
      {...register("default_weight_grams")}
      type="number"
      min="0"
      placeholder="e.g. 200"
    />
    <p className="text-xs text-muted-foreground mt-1">
      Used for all products in this category
    </p>
  </Field>
</div>
```

- [ ] **Step 5: Manual verify** — add a category with HSN code + weight, edit it, confirm values persist

- [ ] **Step 6: Commit**

```bash
git add src/admin/components/CategoryForm.js
git commit -m "feat: category form — HSN code and default weight fields"
```

---

## Task 4: CategoryTable — HSN + Weight Columns with Inline Edit

**Files:**
- Modify: `src/admin/components/CategoryTable.js`

- [ ] **Step 1: Update select query** to fetch new columns

```js
const { data, error } = await supabase
  .from("categories")
  .select("categoryid, name, description, hsn_code, default_weight_grams")
  .order("name");
```

- [ ] **Step 2: Update editValues state** to include new fields

```js
const [editValues, setEditValues] = useState({
  name: "",
  description: "",
  hsn_code: "",
  default_weight_grams: "",
});
```

- [ ] **Step 3: Update startEdit** to populate new fields

```js
const startEdit = (c) => {
  setEditingId(c.categoryid);
  setEditValues({
    name: c.name,
    description: c.description || "",
    hsn_code: c.hsn_code || "",
    default_weight_grams: c.default_weight_grams ?? "",
  });
};
```

- [ ] **Step 4: Update saveEdit** to persist new fields

```js
const saveEdit = async (categoryid) => {
  if (!editValues.name.trim()) { toast.error("Name is required"); return; }
  setSaving(true);
  const { error } = await supabase
    .from("categories")
    .update({
      name: editValues.name.trim(),
      description: editValues.description.trim() || null,
      hsn_code: editValues.hsn_code.trim() || null,
      default_weight_grams: editValues.default_weight_grams === "" ? null : Number(editValues.default_weight_grams),
    })
    .eq("categoryid", categoryid);
  setSaving(false);
  if (error) { toast.error("Failed to save", { description: error.message }); }
  else { toast.success("Category updated"); setEditingId(null); fetchCategories(); }
};
```

- [ ] **Step 5: Add table header columns**

Replace `<thead>` with:

```jsx
<thead className="bg-muted">
  <tr>
    <th className="px-3 py-2 text-left w-28">ID</th>
    <th className="px-3 py-2 text-left w-48">Name</th>
    <th className="px-3 py-2 text-left">Description</th>
    <th className="px-3 py-2 text-left w-28">HSN Code</th>
    <th className="px-3 py-2 text-left w-32">Default Weight</th>
    <th className="px-3 py-2 text-center w-24">Actions</th>
  </tr>
</thead>
```

- [ ] **Step 6: Add table body cells** for new columns, inside the `<tr>` for each category row, after the description cell and before the actions cell

```jsx
<td className="px-3 py-2">
  {isEditing ? (
    <Input
      value={editValues.hsn_code}
      onChange={(e) => setEditValues((v) => ({ ...v, hsn_code: e.target.value }))}
      className="h-8 text-sm w-24"
      placeholder="620590"
      maxLength={10}
    />
  ) : (
    <span className="font-mono text-xs">{c.hsn_code || <span className="text-muted-foreground">—</span>}</span>
  )}
</td>
<td className="px-3 py-2">
  {isEditing ? (
    <Input
      value={editValues.default_weight_grams}
      type="number"
      min="0"
      onChange={(e) => setEditValues((v) => ({ ...v, default_weight_grams: e.target.value }))}
      className="h-8 text-sm w-24"
      placeholder="200"
    />
  ) : (
    <span className="text-sm">
      {c.default_weight_grams != null
        ? `${c.default_weight_grams}g`
        : <span className="text-muted-foreground">—</span>}
    </span>
  )}
</td>
```

- [ ] **Step 7: Update colSpan on empty row** from 4 to 6

```jsx
<td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
```

- [ ] **Step 8: Manual verify** — categories table shows HSN and weight columns, inline edit works for both

- [ ] **Step 9: Commit**

```bash
git add src/admin/components/CategoryTable.js
git commit -m "feat: category table — HSN code and weight columns with inline edit"
```

---

## Task 5: ProductEditDialog — Shipping Section

**Files:**
- Modify: `src/admin/components/ProductEditDialog.js`

- [ ] **Step 1: Update Zod formSchema** — add shipping fields

Add to `formSchema`:

```js
weight_override_grams: z.coerce
  .number({ invalid_type_error: "Must be a number" })
  .int("Whole number")
  .nonnegative()
  .optional()
  .nullable()
  .transform((v) => (v === "" || v === undefined ? null : v)),
length_cm: z.coerce.number().nonnegative().optional().nullable()
  .transform((v) => (v === "" || v === undefined ? null : v)),
width_cm: z.coerce.number().nonnegative().optional().nullable()
  .transform((v) => (v === "" || v === undefined ? null : v)),
height_cm: z.coerce.number().nonnegative().optional().nullable()
  .transform((v) => (v === "" || v === undefined ? null : v)),
```

- [ ] **Step 2: Update defaultValues in useForm**

```js
weight_override_grams: "",
length_cm: "",
width_cm: "",
height_cm: "",
```

- [ ] **Step 3: Update form.reset in useEffect** to include new fields from product

```js
form.reset({
  ...product,
  weight_override_grams: product.weight_override_grams ?? "",
  length_cm: product.length_cm ?? "",
  width_cm: product.width_cm ?? "",
  height_cm: product.height_cm ?? "",
  variants: mappedVariants,
});
```

- [ ] **Step 4: Pass new fields through onSave**

In `handleSubmit`, the `updated` object already spreads `values` via `{ ...product, ...values }`, so new fields pass through automatically. No change needed here.

- [ ] **Step 5: Add Shipping section to JSX**

Find the closing area of the form (before the submit button or variant section) and add:

```jsx
{/* Shipping */}
<div className="border rounded-md p-4 space-y-3">
  <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Shipping</p>

  {/* Show inherited weight from category as placeholder hint */}
  <FormField
    name="weight_override_grams"
    control={form.control}
    render={({ field }) => {
      const selectedCategoryId = form.watch("categoryid");
      const cat = categories.find((c) => c.categoryid === selectedCategoryId);
      return (
        <FormItem>
          <FormLabel>Weight Override (grams)</FormLabel>
          <FormControl>
            <Input
              {...field}
              type="number"
              min="0"
              placeholder={cat?.default_weight_grams != null ? `${cat.default_weight_grams} (from category)` : "e.g. 200"}
            />
          </FormControl>
          {cat?.default_weight_grams != null && !field.value && (
            <p className="text-xs text-muted-foreground">
              Using category default: {cat.default_weight_grams}g
            </p>
          )}
          <FormMessage />
        </FormItem>
      );
    }}
  />

  <div className="grid grid-cols-3 gap-3">
    <FormField
      name="length_cm"
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Length (cm)</FormLabel>
          <FormControl><Input {...field} type="number" step="0.1" min="0" placeholder="—" /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    <FormField
      name="width_cm"
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Width (cm)</FormLabel>
          <FormControl><Input {...field} type="number" step="0.1" min="0" placeholder="—" /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
    <FormField
      name="height_cm"
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Height (cm)</FormLabel>
          <FormControl><Input {...field} type="number" step="0.1" min="0" placeholder="—" /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </div>
</div>
```

- [ ] **Step 6: Ensure categories prop passes hsn_code and default_weight_grams**

In `InventoryPage.js`, find where categories are fetched and ensure the select includes the new fields:

```js
// Find the categories fetch — update select to include shipping fields
supabase.from("categories").select("categoryid, name, hsn_code, default_weight_grams")
```

- [ ] **Step 7: Manual verify** — open product edit, confirm Shipping section renders, weight shows category default as hint, save works, values persist in DB

- [ ] **Step 8: Commit**

```bash
git add src/admin/components/ProductEditDialog.js src/admin/pages/InventoryPage.js
git commit -m "feat: product edit — shipping section (weight override + dimensions)"
```

---

## Task 6: ProductTable — Effective Weight Column

**Files:**
- Modify: `src/admin/components/ProductTable.js`
- Modify: `src/admin/components/ProductRow.js`

- [ ] **Step 1: Import shippingUtils in ProductRow**

```js
import { resolveEffectiveWeight } from "../../utility/shippingUtils";
```

- [ ] **Step 2: Add weight cell to ProductRow JSX**

`ProductRow` already receives `categories` and `product` props. Add a weight cell after the existing price/markup cells:

```jsx
{(() => {
  const cat = categories.find((c) => c.categoryid === product.categoryid) ?? null;
  const weight = resolveEffectiveWeight(product, cat);
  return (
    <td className="w-24 text-center text-sm">
      {weight != null ? (
        <span>{weight}g</span>
      ) : (
        <span className="text-red-400 text-xs">No weight</span>
      )}
    </td>
  );
})()}
```

- [ ] **Step 3: Add Weight column header to ProductTable thead**

In `ProductTable.js`, find the `<thead>` block (around line 356) and add after the existing `<th>` entries:

```jsx
<th className="w-24 text-center">Weight</th>
```

- [ ] **Step 4: Manual verify** — inventory table shows Weight column; products with category weight show value; products with no category weight show red "No weight" flag

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/ProductRow.js src/admin/components/ProductTable.js
git commit -m "feat: inventory table — effective weight column with null flag"
```
