# Fabric / Meter Unit Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow products to be defined as `unit_type='meter'` so stock is tracked in meters (decimal), billing supports fractional quantities, and all display/validation adapts accordingly — without creating new components.

**Architecture:** Add `unit_type` column to `products` (piece | meter). Widen integer columns to `numeric(10,3)` in DB. Thread `unit_type` through the existing inventory and billing components via prop and payload changes. Store `unit_type` in `bill_items` as a denormalized copy so loaded bills don't need a join.

**Tech Stack:** React 19, Supabase (PostgreSQL), React Hook Form + Zod, Shadcn/ui, Tailwind

---

## Pitfalls Identified (addressed in plan below)

| # | Location | Issue | Fix in |
|---|----------|--------|--------|
| P1 | `ItemRow.js:43` | `parseInt` silently truncates `2.5` → `2` for meter qty | Task 6 |
| P2 | `InventoryPicker.js` qty Input | No `step` attr; browser rounds decimals on blur | Task 5 |
| P3 | `ProductEditDialog.js` stock Input | No `step` attr; browser enforces integer increments for stock entry | Task 2 |
| P4 | `VariantRow.js` formatStock | Always appends "pcs"; no `unit_type` awareness | Task 3 |
| P5 | `ProductRow.js` | Renders `<VariantRow>` without `unitType` prop | Task 4 |
| P6 | `InventoryPicker.js` products query | Doesn't fetch `unit_type`; can't show unit or set correct step | Task 5 |
| P7 | `InventoryPicker.js` variant stock label | Shows raw number with no unit in dropdown | Task 5 |
| P8 | `billUtils.js:186,260` | `for (i=0; i<2.5; i++)` loops silently under-count meters in `buy_x_get_y` / `bundled_pricing` discount types | Task 7 |
| P9 | `BillingForm.js` bill load | Loaded `bill_items` rows don't carry `unit_type`; `ItemRow` gets `undefined` → falls back to parseInt | Tasks 7 + 8 |
| P10 | `ItemRow.js` qty Input | `min={1}` hard-coded; meter items need `min={0.1}` | Task 6 |

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `schema/migration_fabric_unit_type.sql` | Create | DB schema changes |
| `src/admin/components/ProductEditDialog.js` | Modify | Add unit_type field + step-aware stock input |
| `src/admin/components/VariantRow.js` | Modify | Unit-aware stock display |
| `src/admin/components/ProductRow.js` | Modify | Pass `unitType` prop to VariantRow |
| `src/admin/components/billing/InventoryPicker.js` | Modify | Fetch unit_type, decimal qty input, unit labels |
| `src/admin/components/billing/ItemRow.js` | Modify | parseFloat for meters, min/step attrs |
| `src/admin/components/billing/stockHelpers.js` | Modify | Write unit_type into bill_items payload |
| `src/admin/components/billing/BillingForm.js` | Modify | Map unit_type from loaded bill_items rows |
| `src/admin/components/billing/billUtils.js` | Modify | Guard discount loops for meter items |
| `src/admin/components/billing/__tests__/stockDelta.test.js` | Modify | Add decimal quantity test cases |

---

## Task 1: DB Migration

**Files:**
- Create: `schema/migration_fabric_unit_type.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Add unit_type to products: 'piece' (default) or 'meter'
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_type varchar(10) NOT NULL DEFAULT 'piece';

-- Widen stock to support decimal meters
ALTER TABLE public.productsizecolors
  ALTER COLUMN stock TYPE numeric(10,3);

-- Widen stock transaction quantity
ALTER TABLE public.stocktransactions
  ALTER COLUMN quantity TYPE numeric(10,3);

-- Widen bill_items quantity and add denormalized unit_type
ALTER TABLE public.bill_items
  ALTER COLUMN quantity TYPE numeric(10,3);

ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS unit_type varchar(10) NOT NULL DEFAULT 'piece';
```

- [ ] **Step 2: Run migration in Supabase SQL editor**

Paste and execute the file contents in the Supabase dashboard SQL editor.
Verify with:
```sql
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name IN ('products','productsizecolors','stocktransactions','bill_items')
  AND column_name IN ('unit_type','stock','quantity')
ORDER BY table_name, column_name;
```
Expected: `unit_type` as `character varying(10)` on products and bill_items; `stock`/`quantity` as `numeric` on productsizecolors, stocktransactions, bill_items.

- [ ] **Step 3: Commit the migration file**

```bash
git add schema/migration_fabric_unit_type.sql
git commit -m "db: add unit_type to products, widen stock/quantity columns to numeric"
```

---

## Task 2: ProductEditDialog — Add unit_type Field + Fix Stock Input Step

**Files:**
- Modify: `src/admin/components/ProductEditDialog.js`

The dialog uses React Hook Form + Zod. `formSchema` needs `unit_type`. The stock Input inside the variant row loop needs `step` set dynamically. The component must watch `unit_type` to conditionally set `step`.

- [ ] **Step 1: Extend Zod schemas**

In `ProductEditDialog.js`, update `variantSchema` and `formSchema`:

```js
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
```

- [ ] **Step 2: Add unit_type to defaultValues**

In the `useForm` call, add `unit_type: "piece"` to `defaultValues`:

```js
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
```

- [ ] **Step 3: Watch unit_type for conditional step**

After the `useFieldArray` line, add:

```js
const watchedUnitType = form.watch("unit_type");
const isMeter = watchedUnitType === "meter";
```

- [ ] **Step 4: Add unit_type toggle UI**

Add this block after the `purchaseprice`/`retailprice` grid and before the `description` field (around line 317, after the closing `</div>` of the price grid):

```jsx
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
```

- [ ] **Step 5: Make variant stock Input step-aware**

Replace the existing variant stock Input (around line 424):

```jsx
<Input
  type="number"
  placeholder={isMeter ? "Stock (m)" : "Stock"}
  step={isMeter ? "0.001" : "1"}
  min="0"
  {...form.register(`variants.${index}.stock`, {
    valueAsNumber: true,
  })}
/>
```

- [ ] **Step 6: Commit**

```bash
git add src/admin/components/ProductEditDialog.js
git commit -m "feat(inventory): add unit_type field to ProductEditDialog, step-aware stock input"
```

---

## Task 3: VariantRow — Unit-Aware Stock Display

**Files:**
- Modify: `src/admin/components/VariantRow.js`

- [ ] **Step 1: Update formatStock and VariantRow**

Replace the entire file contents:

```js
const formatStock = (value, unitType = "piece") => {
  if (isNaN(value)) return unitType === "meter" ? "0 m" : "0 pcs";
  const num = Number(value);
  const formatted =
    unitType === "meter"
      ? num.toLocaleString("en-IN", { maximumFractionDigits: 3 })
      : num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${formatted} ${unitType === "meter" ? "m" : "pcs"}`;
};

const VariantRow = ({ row, colSpan, unitType = "piece" }) => {
  return (
    <tr className="variant-row">
      <td colSpan={colSpan}>
        <div className="variant-line">
          <div className="variant-part">
            <strong>Size:</strong> {row.size}
          </div>
          <div className="variant-separator">|</div>
          <div className="variant-part">
            <strong>Color:</strong> {row.color}
          </div>
          <div className="variant-separator">|</div>
          <div className="variant-part">
            <strong>Stock:</strong> {formatStock(row.stock, unitType)}
          </div>
        </div>
      </td>
    </tr>
  );
};

export default VariantRow;
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/components/VariantRow.js
git commit -m "feat(inventory): VariantRow shows 'm' unit for meter products"
```

---

## Task 4: ProductRow — Pass unitType to VariantRow

**Files:**
- Modify: `src/admin/components/ProductRow.js`

`product.unit_type` is available because `ProductTable` does `select("*")` which now includes `unit_type`.

- [ ] **Step 1: Pass unitType prop**

Find the `<VariantRow>` render (around line 126) and add the `unitType` prop:

```jsx
<VariantRow
  key={`${product.productid}-${index}`}
  row={row}
  colSpan={12}
  unitType={product.unit_type || "piece"}
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/components/ProductRow.js
git commit -m "feat(inventory): pass unitType to VariantRow from ProductRow"
```

---

## Task 5: InventoryPicker — Fetch unit_type, Decimal Qty, Unit Labels

**Files:**
- Modify: `src/admin/components/billing/InventoryPicker.js`

Three changes: (1) add `unit_type` to both product select queries, (2) make qty Input step/min-aware, (3) show unit suffix in variant stock label and stock error message.

- [ ] **Step 1: Add unit_type to the product queries**

There are two product select calls. Update **both**:

First (edit-mode load, around line 40):
```js
supabase
  .from("products")
  .select("productid, categoryid, purchaseprice, retailprice, name, unit_type")
  .eq("productid", initialVal.productid)
  .single()
  .then(({ data }) => {
    if (data) setSelected(data);
  });
```

Second (search results, around line 53):
```js
const { data, error } = await supabase
  .from("products")
  .select("productid, categoryid, purchaseprice, retailprice, name, unit_type")
  .ilike("productid", `%${query}%`)
  .limit(10);
```

- [ ] **Step 2: Derive isMeter from selected product**

After the `effectiveStock` function definition, add:

```js
const isMeter = selected?.unit_type === "meter";
```

- [ ] **Step 3: Update qty Input to be step/min-aware**

Replace the Quantity input block (around line for `<Label>Quantity</Label>`):

```jsx
<div className="grid gap-1">
  <Label>Quantity {isMeter && <span className="text-xs text-muted-foreground">(meters)</span>}</Label>
  <Input
    type="number"
    min={isMeter ? 0.1 : 1}
    step={isMeter ? 0.1 : 1}
    placeholder={isMeter ? "Enter meters" : "Enter Quantity"}
    value={qty}
    onChange={(e) => setQty(e.target.value)}
  />
  {error && <p className="text-red-500 text-sm">{error}</p>}
</div>
```

- [ ] **Step 4: Show unit in variant stock label**

Update the variant SelectItem (around line for `(Stock: {effectiveStock(v)})`):

```jsx
{variants.map((v) => (
  <SelectItem
    key={v.variantid}
    value={v.variantid}
    disabled={!isBackdated && effectiveStock(v) <= 0}
  >
    {v.color} | {v.size} | (Stock: {effectiveStock(v)}{isMeter ? " m" : " pcs"})
  </SelectItem>
))}
```

- [ ] **Step 5: Show unit in stock error message**

Update the stock error in the `useEffect` that sets `error` (around line 93):

```js
if (!isBackdated && chosenVariant && Number(qty) > effectiveStock(chosenVariant)) {
  const unit = isMeter ? "m" : "pcs";
  setError(`Only ${effectiveStock(chosenVariant)} ${unit} left in stock`);
} else {
  setError("");
}
```

Note: also change `qty > effectiveStock(...)` to `Number(qty) > effectiveStock(...)` since `qty` is a string from the Input `onChange`.

- [ ] **Step 6: Include unit_type in onPicked payload**

In the `onPicked` call inside the `<Button onClick>` handler, add `unit_type`:

```js
onPicked({
  _id: uuidv4(),
  source: "inventory",
  productid: selected.productid,
  variantid: variantId,
  product_name: selected.name,
  category: selected.categoryid || null,
  size: chosenVariant?.size || null,
  color: chosenVariant?.color || null,
  stock: chosenVariant?.stock ?? null,
  quantity: Number(qty),
  mrp: Number(selected.retailprice || 0),
  quickDiscountPct: Number(discount) || 0,
  gstRate: gstRate,
  alteration_charge: Number(alterationCharge) || 0,
  stitchType,
  unit_type: selected.unit_type || "piece",
  salesperson_id: salespersonId || null,
});
```

- [ ] **Step 7: Commit**

```bash
git add src/admin/components/billing/InventoryPicker.js
git commit -m "feat(billing): InventoryPicker supports meter unit_type — decimal qty, unit labels, stock error"
```

---

## Task 6: ItemRow — Fix parseInt, Decimal Step, Unit Min

**Files:**
- Modify: `src/admin/components/billing/ItemRow.js`

- [ ] **Step 1: Replace the quantity Input block**

Find the qty `<Input>` (around line 37–47). Replace:

```jsx
<td className="px-2 py-1 text-center">
  <Input
    type="number"
    min={item.unit_type === "meter" ? 0.1 : 1}
    step={item.unit_type === "meter" ? 0.1 : 1}
    value={item.quantity}
    onChange={(e) =>
      onUpdate(item._id, {
        quantity:
          item.unit_type === "meter"
            ? parseFloat(e.target.value || "0.1")
            : parseInt(e.target.value || "1", 10),
      })
    }
    className="h-7 w-14 mx-auto text-center"
  />
</td>
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/components/billing/ItemRow.js
git commit -m "fix(billing): ItemRow uses parseFloat for meter items, fixes silent integer truncation"
```

---

## Task 7: stockHelpers — Write unit_type to bill_items Payload

**Files:**
- Modify: `src/admin/components/billing/stockHelpers.js`

`buildBillItemsPayload` builds the objects inserted into `bill_items`. Adding `unit_type` here means it is persisted and available when the bill is loaded for editing later (addresses P9).

- [ ] **Step 1: Add unit_type to the return object in buildBillItemsPayload**

In the `return items.map(...)` inside `buildBillItemsPayload`, add `unit_type` to the returned object:

```js
return {
  billid,
  quantity: it.quantity,
  mrp: it.mrp,
  variantid: it.variantid || null,
  product_name: it.product_name || it.name || "",
  product_code: it.productid || it.product_code || null,
  category: it.category || null,
  alteration_charge: Number(it.alteration_charge || 0),
  discount_total: round2(
    priced.itemDisc + itemOverallDisc + itemBalanceDisc,
  ),
  subtotal: adjustedSubtotal,
  gst_rate: gstRate,
  gst_amount: adjustedGst,
  total: round2(adjustedSubtotal + adjustedGst),
  stitch_type: stitchType,
  unit_type: it.unit_type || "piece",
  salesperson_id: it.salesperson_id || null,
};
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/components/billing/stockHelpers.js
git commit -m "feat(billing): persist unit_type in bill_items payload for edit-load correctness"
```

---

## Task 8: BillingForm — Map unit_type from Loaded bill_items

**Files:**
- Modify: `src/admin/components/billing/BillingForm.js`

When an existing bill is loaded, `bill_items` rows are mapped to form item objects. `unit_type` is now stored in `bill_items` (from Task 7). Map it into the item so `ItemRow` gets it.

- [ ] **Step 1: Add unit_type to the bill_items mapping**

Find the `setItems(...)` call with the `.map((bi) => ({...}))` (around line 372). Add `unit_type` to the mapped object:

```js
setItems(
  (billItems || []).map((bi) => ({
    _id: String(bi.bill_item_id),
    source: bi.variantid ? "inventory" : "manual",
    variantid: bi.variantid || null,
    productid: bi.product_code || null,
    product_name: bi.product_name || "",
    category: bi.category || null,
    quantity: bi.quantity,
    mrp: bi.mrp,
    unit_type: bi.unit_type || "piece",
    alteration_charge: bi.alteration_charge || 0,
    quickDiscountPct: backCalcDiscountPct(
      bi.discount_total,
      bi.mrp,
      bi.quantity,
    ),
    gstRate: bi.gst_rate ?? 18,
    stitchType:
      bi.stitch_type ||
      (Number(bi.gst_rate) === 18 ? "stitched" : "unstitched"),
    size:
      variantMap[bi.variantid]?.size ||
      manualMap[bi.product_code]?.size ||
      null,
    color:
      variantMap[bi.variantid]?.color ||
      manualMap[bi.product_code]?.color ||
      null,
    salesperson_id: bi.salesperson_id || null,
  })),
);
```

- [ ] **Step 2: Commit**

```bash
git add src/admin/components/billing/BillingForm.js
git commit -m "feat(billing): map unit_type from loaded bill_items rows for ItemRow decimal handling"
```

---

## Task 9: billUtils — Guard Discount Loops for Meter Items

**Files:**
- Modify: `src/admin/components/billing/billUtils.js`

`buy_x_get_y` and `bundled_pricing` discount types use `for (i=0; i<quantity; i++)` loops to count individual units. JS naturally truncates `2.5` to 2 iterations. More fundamentally, these discrete discount semantics don't apply to continuous goods (you can't "buy 2 meters get 1 free" in the same way). Skip meter items from these loops.

- [ ] **Step 1: Guard getFreeItems loop**

In `getFreeItems`, inside the `items.forEach` callback, add a meter guard before the loop:

```js
items.forEach((it, itemIndex) => {
  if (!matchesCategories(it, d)) return;
  if (it.unit_type === "meter") return; // discrete buy_x_get_y N/A for meter goods
  const p = priceItem(it);
  const unitPrice = p.withCharges / (it.quantity || 1);
  for (let i = 0; i < (it.quantity || 1); i++) {
    eligible.push({ itemIndex, unitPrice });
  }
});
```

- [ ] **Step 2: Guard bundled_pricing loop**

In the `bundled_pricing` case inside `computeDiscount`, add a meter guard:

```js
items.forEach((it) => {
  if (!matchesCategories(it, d)) return;
  if (it.unit_type === "meter") return; // bundled_pricing N/A for meter goods
  const p = priceItem(it);
  const unitPrice = p.withCharges / (it.quantity || 1);
  for (let i = 0; i < (it.quantity || 1); i++) {
    eligible.push(unitPrice);
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/billing/billUtils.js
git commit -m "fix(billing): skip meter items in buy_x_get_y and bundled_pricing discount loops"
```

---

## Task 10: Tests — Decimal Quantity Coverage

**Files:**
- Modify: `src/admin/components/billing/__tests__/stockDelta.test.js`

- [ ] **Step 1: Add decimal quantity tests**

Append to `stockDelta.test.js`:

```js
describe("computeStockDelta — meter (decimal) quantities", () => {
  it("new meter item: 2.5 quantity → delta -2.5", () => {
    const existing = [];
    const newItems = [{ variantid: "v1", quantity: 2.5 }];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBeCloseTo(-2.5);
  });

  it("existing 2.5, new 1.0 → delta +1.5 (stock restored)", () => {
    const existing = [{ variantid: "v1", quantity: 2.5 }];
    const newItems = [{ variantid: "v1", quantity: 1.0 }];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBeCloseTo(1.5);
  });

  it("existing 2.5, removed from bill → delta +2.5", () => {
    const existing = [{ variantid: "v1", quantity: 2.5 }];
    const newItems = [];
    const delta = computeStockDelta(existing, newItems);
    expect(delta["v1"]).toBeCloseTo(2.5);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/abindal/dev/BindalsCreation/retail-inventory && npm test -- --watchAll=false --testPathPattern="stockDelta"
```

Expected: all tests pass including the 3 new decimal tests.

- [ ] **Step 3: Commit**

```bash
git add src/admin/components/billing/__tests__/stockDelta.test.js
git commit -m "test(billing): add decimal quantity tests for meter-type stock delta"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Fabric products entered in Inventory with meter unit type → Task 1 + 2
- ✅ Stock tracked as meters (decimal), display shows "m" → Tasks 3, 4, 5
- ✅ Bills allow fractional meter quantities → Tasks 5, 6
- ✅ Buying fabric deducts meters from stock (not integers) → Tasks 1, 7, 8 (stock delta math already uses `Number()`)
- ✅ Existing integer-based products unaffected → `unit_type` defaults to `'piece'` everywhere; `parseInt` kept for piece items

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:** `unit_type` string `"piece" | "meter"` used consistently across all files. `isMeter` boolean derived locally where needed. `Number(qty)` used for stock comparison throughout.
