# Refactoring Opportunities

## Summary

~2000–2500 lines can be eliminated. 10 patterns identified across 30+ files.

| Pattern | Severity | Occurrences | Est. Lines Saved |
|---------|----------|-------------|-----------------|
| Fetch/load/error boilerplate | HIGH | 16 files | 200–300 |
| Dialog state management | HIGH | 5 pages | 500+ |
| Monolithic components | CRITICAL | 6 components | 3000+ (split into 15–20 focused) |
| Copy-pasted form layouts | MEDIUM | 5 forms | 200+ |
| Table pagination duplication | MEDIUM | 4 tables | 150+ |
| Supabase multi-fetch orchestration | MEDIUM | 3 locations | 200+ |
| Formatting helpers not reused | LOW | 4–5 locations | 50+ |
| Billing utils scattered | MEDIUM | 3 files | docs only |
| Filter state duplication | MEDIUM | 3 tables | 100+ |
| Form submission error handling | LOW | 5+ forms | 150+ |

---

## 1. Fetch/Load/Error Boilerplate → `useSupabaseQuery` hook

**Severity: HIGH | 16 files**

Every table/list component repeats:

```js
const [data, setData] = useState([]);
const [loading, setLoading] = useState(false);
useEffect(() => {
  setLoading(true);
  const { data } = await supabase.from("table").select(...);
  setData(data || []);
  setLoading(false);
}, [deps]);
```

**Affected files:**
- `src/admin/components/BillTable.js` (lines 21–24, 258–289)
- `src/admin/components/ProductTable.js` (lines 31–37, 62–100)
- `src/admin/components/CustomerTable.js` (lines 20–22, 33–92)
- `src/admin/components/DiscountTable.js` (lines 8–21, 58–81)
- `src/admin/pages/InventoryPage.js` (lines 14–16, 36–44)
- `src/admin/pages/MockupGraphsPage.js` (lines 10–11, 13–33)
- + 10 more

**Fix:** Create `src/hooks/useSupabaseQuery.ts`

```ts
function useSupabaseQuery(table, selectClause, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from(table).select(selectClause);
      if (error) throw error;
      setData(data || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [table, selectClause, ...deps]);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, error, refetch };
}
```

---

## 2. Dialog State Management → `useEntityManagement` hook

**Severity: HIGH | 5 page files**

Every entity page repeats open/edit/refresh state:

```js
const [formOpen, setFormOpen] = useState(false);
const [editingItem, setEditingItem] = useState(null);
const [refreshSignal, setRefreshSignal] = useState(0);

const handleEdit = (item) => { setEditingItem(item); setFormOpen(true); };
const handleFormSuccess = () => {
  setFormOpen(false);
  setEditingItem(null);
  setRefreshSignal(prev => prev + 1);
};
```

**Affected files:**
- `src/admin/pages/CustomersPage.js` (lines 6–20)
- `src/admin/pages/SuppliersPage.js` (lines 9–19)
- `src/admin/pages/DiscountPage.js` (lines 14–38)
- `src/admin/pages/BillingPage.js` (lines 10–51)
- `src/admin/pages/InventoryPage.js` (lines 13–34)

**Fix:** Create `src/hooks/useEntityManagement.ts`

```ts
function useEntityManagement() {
  const [formOpen, setFormOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const openForm = (entity = null) => { setEditingEntity(entity); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingEntity(null); };
  const handleSuccess = () => { closeForm(); setRefreshSignal(prev => prev + 1); };

  return { formOpen, setFormOpen, editingEntity, openForm, closeForm, handleSuccess, refreshSignal };
}
```

---

## 3. Monolithic Components — Split Required

**Severity: CRITICAL | 6 components**

| File | Lines | Problem |
|------|-------|---------|
| `src/admin/components/billing/BillingForm.js` | ~2447 | Billing logic, item mgmt, discounts, summary all in one |
| `src/admin/pages/ExchangePage.js` | ~762 | Search, history pagination, receipt generation mixed |
| `src/admin/components/BillTable.js` | ~1003 | Table, PDF regen, SMS sending, cancellation logic |
| `src/admin/components/DiscountForm.js` | ~682 | 6 discount types + category multiselect in one form |
| `src/admin/components/ProductTable.js` | ~629 | Pagination, filtering, product rows, inline editing |
| `src/admin/components/ProductEditDialog.js` | ~522 | Product + variant editing with variant diff logic |

### BillingForm.js splits:
- `useInvoicePdfRegeneration()` hook — PDF regen state/logic
- `<BillingSummarySection />` — summary display
- `<ItemManagementSection />` — item table + add dialog
- `useDiscountApplication()` hook — discount auto-apply logic

### ExchangePage.js splits:
- `<ExchangeSearchForm />` — bill search interface
- `<ExchangeHistoryTable />` — paginated history display
- `useExchangeCredit()` hook — credit calculation

### BillTable.js splits:
- `useBillPdfGeneration()` hook — PDF regen logic (lines 36–194)
- `<BillActionButtons />` — action button row (lines 688–768)
- `<BillCancelDialogs />` — two-step cancel flow (lines 810–944)

---

## 4. Copy-Pasted Form Layouts → `<EntityFormDialog />`

**Severity: MEDIUM | 5 forms**

All entity forms share the same Dialog + react-hook-form + Zod + submit button scaffold:

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent>
    <DialogHeader><DialogTitle>{isEditing ? "Edit" : "Add"} {Entity}</DialogTitle></DialogHeader>
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)}>
        <FormField name="field1" ... />
        <Button type="submit">{isEditing ? "Update" : "Save"}</Button>
      </form>
    </Form>
  </DialogContent>
</Dialog>
```

**Affected files:**
- `src/admin/components/CustomerForm.js`
- `src/admin/components/SupplierForm.js` (~190 lines)
- `src/admin/components/DiscountForm.js` (~682 lines)
- `src/admin/components/ProductEditDialog.js` (~522 lines)

**Fix:** Create `src/components/EntityFormDialog.tsx`

```tsx
function EntityFormDialog({ open, onOpenChange, title, children, onSubmit, loading }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" onClick={onSubmit} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 5. Table Pagination/Loading/Empty → `<DataTable />`

**Severity: MEDIUM | 4 tables**

All table components independently implement:
- `page` state + `ROWS_PER_PAGE` constant
- Loading skeleton
- Empty state row
- Prev/Next pagination buttons

**Affected files:**
- `src/admin/components/BillTable.js` (lines 586–807)
- `src/admin/components/ProductTable.js`
- `src/admin/components/CustomerTable.js`
- `src/admin/components/DiscountTable.js` (lines 83–179)

**Fix:** Create `src/components/DataTable.tsx`

```tsx
type Column<T> = { id: string; label: string; render: (row: T) => ReactNode };

function DataTable<T>({
  columns, data, loading, page, pageSize = 50,
  onPageChange, emptyMessage = "No data found",
}: DataTableProps<T>) {
  return (
    <>
      <div className="border rounded-2xl overflow-hidden">
        {loading ? <LoadingSkeleton /> : (
          <table className="w-full text-sm">
            <thead>
              <tr>{columns.map(c => <th key={c.id}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {data.length === 0
                ? <tr><td colSpan={columns.length} className="text-center py-8 text-muted-foreground">{emptyMessage}</td></tr>
                : data.map((row, i) => (
                  <tr key={i}>{columns.map(c => <td key={c.id}>{c.render(row)}</td>)}</tr>
                ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex justify-between mt-2">
        <Button disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <span>Page {page}</span>
        <Button disabled={data.length < pageSize} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </>
  );
}
```

---

## 6. Supabase Multi-Fetch → `useBillData` hook

**Severity: MEDIUM | 3 locations**

Bill detail fetching with variants, manual items, customers, salespersons is orchestrated inline in 3 places:

**Affected files:**
- `src/admin/components/BillTable.js` (lines 41–105)
- `src/admin/components/billing/BillingForm.js` (~lines 100–200)
- `src/admin/pages/ExchangePage.js` (lines 53–96)

**Fix:** Create `src/hooks/useBillData.ts`

```ts
async function fetchBillWithDetails(billId: string) {
  const [{ data: bill }, { data: items }] = await Promise.all([
    supabase.from("bills").select("*, customers(*), profiles(*)").eq("billid", billId).single(),
    supabase.from("bill_items").select("*").eq("billid", billId),
  ]);

  const variantIds = items.filter(i => i.variantid).map(i => i.variantid);
  const { data: variants } = variantIds.length
    ? await supabase.from("productsizecolors").select("*").in("variantid", variantIds)
    : { data: [] };

  return {
    bill,
    items,
    variantMap: Object.fromEntries(variants.map(v => [v.variantid, v])),
  };
}
```

---

## 7. Formatting Helpers Not Consistently Used

**Severity: LOW | 4–5 locations**

`src/utility/dateFormat.js` and `src/utility/formatPhone.js` exist but components re-implement inline:

**Affected files:**
- `src/admin/components/BillTable.js` (line 639–641): inline date format
- `src/admin/components/CustomerTable.js` (lines 112–119): local `formatPhoneNumber()`
- `src/admin/components/SupplierTable.js` (lines 51–58): local `formatPhone()`

**Fix:** Delete local copies, import from `src/utility/` consistently.

---

## 8. Billing Utils Consolidation

**Severity: MEDIUM | 3 files**

Logic is split but interdependent — requires tracing 3 files to understand full billing flow:

- `src/admin/components/billing/billUtils.js` (289 lines) — `priceItem()`, `computeBillTotals()`
- `src/admin/components/billing/stockHelpers.js` (138 lines) — stock deltas, discount calc
- `src/admin/components/billing/exchangeHelpers.js` (76 lines) — exchange credit

**Fix:** Create `src/lib/billEngine.ts` as a re-export barrel with pipeline docs:

```ts
// Pipeline: raw items → priceItem() → computeBillTotals() → Summary
//                                  ↘ computeCreditsApplied() (exchanges)
export { priceItem, computeBillTotals, normalizeItem, round2 } from '../admin/components/billing/billUtils';
export { computeStockDelta } from '../admin/components/billing/stockHelpers';
export { computeCreditsApplied } from '../admin/components/billing/exchangeHelpers';
```

---

## 9. Filter State Duplication → `useTableFilters` hook

**Severity: MEDIUM | 3 tables**

**Affected files:**
- `src/admin/pages/InventoryPage.js` (lines 17–32): 12-field filter object + reset (lines 127–142)
- `src/admin/components/CustomerTable.js` (lines 21–28): 6-field filter object
- `src/admin/components/ProductTable.js` (lines 41–45): filter + debounced filters

**Fix:** Create `src/hooks/useTableFilters.ts`

```ts
function useTableFilters<T extends object>(initialFilters: T, debounceMs = 300) {
  const [filters, setFilters] = useState(initialFilters);
  const [debouncedFilters, setDebouncedFilters] = useState(filters);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilters(filters), debounceMs);
    return () => clearTimeout(t);
  }, [filters, debounceMs]);

  const resetFilters = useCallback(() => setFilters(initialFilters), [initialFilters]);
  const setFilter = <K extends keyof T>(key: K, value: T[K]) =>
    setFilters(prev => ({ ...prev, [key]: value }));

  return { filters, setFilter, setFilters, debouncedFilters, resetFilters };
}
```

---

## 10. Form Submission Error Handling → `useSupabaseFormSubmit` hook

**Severity: LOW | 5+ forms**

All forms repeat the same try/catch with success/error toasts:

```js
try {
  await supabase.from("table").upsert(payload);
  toast.success(`${entity} saved`);
  onSubmit?.();
} catch (err) {
  toast.error("Error saving", { description: err.message });
}
```

**Affected files:**
- `src/admin/components/SupplierForm.js` (lines 74–100)
- `src/admin/components/CustomerForm.js`
- `src/admin/components/DiscountForm.js`

**Fix:** Create `src/hooks/useSupabaseFormSubmit.ts`

```ts
function useSupabaseFormSubmit(table: string) {
  const submit = async (payload: object, isUpdate = false, idField = "id") => {
    try {
      const q = supabase.from(table)[isUpdate ? "update" : "insert"](payload);
      const { error } = isUpdate ? await q.eq(idField, (payload as any)[idField]) : await q;
      if (error) throw error;
      toast.success("Saved successfully");
      return true;
    } catch (err: any) {
      toast.error("Save failed", { description: err.message });
      return false;
    }
  };
  return { submit };
}
```

---

## Confirmation Dialog → `<ConfirmDialog />`

**Bonus | 3 locations**

Two-step confirm flows hand-coded in:
- `src/admin/components/BillTable.js` (lines 810–944) — bill cancellation
- `src/admin/pages/ExchangePage.js` — receipt confirm

**Fix:** Create `src/components/ConfirmDialog.tsx`

```tsx
function ConfirmDialog({
  open, onOpenChange, title, description, children,
  onConfirm, confirmLabel = "Confirm", danger = false, loading = false,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={danger ? "destructive" : "default"} onClick={onConfirm} disabled={loading}>
            {loading ? "Working..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## Recommended Order

**Phase 1 — Highest ROI (hooks, ~1 day)**
1. `useEntityManagement` hook → apply to 5 pages
2. `useSupabaseQuery` hook → apply to 16 components
3. `useTableFilters` hook → apply to 3 tables

**Phase 2 — Components (~2 days)**
4. `<DataTable />` → replace table scaffolding in 4 files
5. `<ConfirmDialog />` → replace inline confirm dialogs
6. `<EntityFormDialog />` → wrap 5 entity forms

**Phase 3 — Billing (~2 days)**
7. Split `BillingForm.js` into 4 focused components
8. Split `BillTable.js` into 3 pieces
9. `useBillData` hook for shared bill fetching
10. `billEngine.ts` barrel re-export

**Phase 4 — Cleanup (~0.5 days)**
11. Delete inline formatting helpers, use `src/utility/` consistently
12. `useSupabaseFormSubmit` hook for 5+ forms
