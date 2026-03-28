# Phase 1: Draft & Stock Management - Research

**Researched:** 2026-03-28
**Domain:** Supabase data persistence, React state management, inventory stock reconciliation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Out-of-Stock Policy):** Block the save if any inventory item's qty exceeds available stock. Show an error listing the specific items and available qty. Staff must fix quantities before saving. Negative stock is not allowed.
- **D-02 (Discount Code Persistence on Draft):** Add an `applied_codes text[]` column to the `bills` table in Phase 1 (schema migration). On draft save, persist the `selectedCodes` array to this column. On draft load (BILL-03), restore `selectedCodes` from `bills.applied_codes`.
- **D-03 (BillTable Status Display):** Add a Status column to BillTable showing a badge (Draft / Finalized / Cancelled) based on `paymentstatus`. Replace the raw `finalized` boolean display with this badge. Include `paymentstatus` in the Phase 1 select query.

### Claude's Discretion

- Draft update approach (BILL-02): delete all old `bill_items` and insert fresh ones — simpler and correct for this phase
- Stock reconciliation implementation: fetch existing `bill_items`, compute delta per variantid, apply delta in client code
- Error handling for partial DB failures: show destructive toast with error message, do not attempt rollback manually (Supabase handles FK constraints)
- Toast message on draft save: "Draft saved — Bill #[id]" (confirms with bill ID per ROADMAP success criterion)

### Deferred Ideas (OUT OF SCOPE)

- **Phase 4 Enhancement:** When cancelling a bill, offer 2 choices: (1) Issue a store credit voucher (default), or (2) Reverse payment in the original payment mode. — This is Phase 4 scope (BILL-05, VOUCH-01). Capture this in Phase 4 context.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BILL-01 | User can save a new bill as Draft (inserts `bills` + `bill_items`, `paymentstatus='draft'`) | Schema verified, `handleSaveDraft` stub located, `computeBillTotals` output maps directly to insert fields |
| BILL-02 | User can update an existing Draft bill (reconciles `bill_items`, adjusts stock delta) | Delete-and-reinsert pattern confirmed; stock delta algorithm documented below |
| BILL-03 | User can load an existing bill into BillingForm (customer, items, salespersons, applied discounts pre-populated) | `billId` prop exists on BillingForm; `useEffect` on `open` is the correct insertion point; `applied_codes` migration required |
| STOCK-01 | Saving a Draft subtracts quantity from `productsizecolors.stock` for each inventory item (variantid present) | `productsizecolors` schema confirmed; `variantid` UUID column is the FK; stock integer column present |
| STOCK-02 | Updating a Draft reconciles stock — restores old quantities and subtracts new quantities for changed items | Requires fetching pre-existing `bill_items` before delete; delta computed client-side and applied per-variantid |
</phase_requirements>

---

## Summary

This phase wires BillingForm's `handleSaveDraft` to Supabase. It is purely data-persistence work — no new UI components are introduced. The form, state shape, and `computeBillTotals` utility are already in place. The work divides into four concerns: (1) schema migration to add `bills.applied_codes`, (2) new-draft save path (insert bills + bill_items + decrement stock), (3) draft-update path (stock delta then delete-and-reinsert bill_items), and (4) load-for-edit path (populate BillingForm state from a fetched bill).

The most operationally sensitive part is stock management. Because Supabase client-side calls are not wrapped in DB transactions, the implementation must follow a safe ordering: validate stock first (read then compare), then write bills, then write bill_items, then decrement stock. Partial failures show a destructive toast and leave stock unchanged — no manual rollback is needed for the draft-only phase (bill_items ON DELETE CASCADE from bills FK, so a failed bill insert leaves nothing behind). D-01 requires a pre-save stock check against current `productsizecolors.stock` values; the check reads live data immediately before the save.

The BillingPage already passes `activeBillId` state but does NOT currently forward it to BillingForm as the `billId` prop — that is a one-line fix required for BILL-03 to work.

**Primary recommendation:** Implement in task order: schema migration → new-draft save → stock decrement → draft update (stock delta + delete-reinsert) → load-for-edit → BillTable status badge.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 1 |
|-----------|-------------------|
| All DB access direct from component via `supabase` client — no API layer | `handleSaveDraft` calls `supabase.from(...)` directly; no service wrapper needed |
| `useToast()` for user feedback | Use `toast({ title, description, variant })` pattern already in BillingForm |
| `setIsSaving(true)` / `finally { setIsSaving(false) }` pattern | Extend the existing `handleSaveDraft` try/catch/finally — don't restructure |
| `refreshFlag` / counter toggle pattern for re-fetches | BillingPage uses `key={refreshTable}` on BillTable — calling `onSubmit()` triggers it |
| Schema migrations go in `schema/migration_*.sql` files, NOT inline edits to `initial_schema.sql` | `applied_codes` column must be a separate `schema/migration_01_applied_codes.sql` |
| Shadcn/ui + Tailwind for status badges | Use Shadcn `Badge` component for Draft / Finalized / Cancelled in BillTable |
| Path alias `@/*` maps to `src/*` | Use `@/components/ui/badge` etc. |

---

## Standard Stack

### Core (already installed — no new dependencies needed for this phase)

| Library | Version | Purpose | Role in Phase 1 |
|---------|---------|---------|-----------------|
| `@supabase/supabase-js` | Already installed | DB reads/writes | All inserts, updates, selects |
| React 19 | Already installed | Component framework | State management, effects |
| Shadcn/ui `Badge` | Already installed (Radix-based) | Status pill in BillTable | Draft / Finalized / Cancelled |
| Sonner / `useToast` | Already installed | Toast notifications | Success + error feedback |

**No new packages required for Phase 1.** The `Badge` component from `src/components/ui/badge.tsx` is available in this Shadcn/ui project — verify it exists before planning that task.

### Version verification

No new packages to verify. Existing stack is confirmed by reading `package.json` and source files directly.

---

## Architecture Patterns

### Established Pattern: Direct Supabase in Component Handler

All DB operations are performed directly inside async handler functions in the component, consistent with the rest of the codebase.

```javascript
// Source: existing BillingForm.js handleSaveDraft skeleton
const handleSaveDraft = async () => {
  setIsSaving(true);
  try {
    // 1. Stock validation
    // 2. Insert bills row → get billid
    // 3. Insert bill_items rows
    // 4. Decrement stock per variantid
    toast({ title: "Draft saved — Bill #" + billid });
    onOpenChange?.(false);
    onSubmit?.();
  } catch (e) {
    toast({ title: "Error", description: e.message, variant: "destructive" });
  } finally {
    setIsSaving(false);
  }
};
```

### Pattern 1: New Draft Save (BILL-01 + STOCK-01)

**What:** Insert `bills`, then `bill_items`, then decrement `productsizecolors.stock`.
**Ordering matters:** Validate stock before any writes. Insert `bills` first (FK parent), then `bill_items` (FK child), then stock updates.

```javascript
// Stock validation — read current stock, compare against items
const inventoryItems = items.filter(it => it.variantid);
const variantIds = inventoryItems.map(it => it.variantid);
const { data: stockData } = await supabase
  .from("productsizecolors")
  .select("variantid, stock, size, color")
  .in("variantid", variantIds);

// Build a map and check each item
const stockMap = Object.fromEntries(stockData.map(r => [r.variantid, r]));
const errors = inventoryItems.filter(it => it.quantity > stockMap[it.variantid]?.stock);
if (errors.length > 0) {
  // Show error listing items with available qty — D-01
  throw new Error(...);
}

// Insert bills row
const { data: bill, error: billError } = await supabase
  .from("bills")
  .insert({
    customerid: selectedCustomerId,
    notes,
    totalamount: computed.grandTotal,
    gst_total: computed.gstTotal,
    discount_total: computed.itemLevelDiscountTotal + computed.overallDiscount,
    taxable_total: computed.taxableTotal,
    paymentstatus: "draft",
    finalized: false,
    applied_codes: selectedCodes,   // D-02 — new column
  })
  .select("billid")
  .single();

// Insert bill_items
const billItemsPayload = items.map(it => ({
  billid: bill.billid,
  quantity: it.quantity,
  mrp: it.mrp,
  variantid: it.variantid || null,
  product_name: it.product_name || it.name,
  product_code: it.product_code || null,
  category: it.category || null,
  alteration_charge: it.alteration_charge || 0,
  discount_total: priceItem(it).itemDisc,
  subtotal: priceItem(it).subtotal,
  gst_rate: it.gstRate ?? 18,
  gst_amount: priceItem(it).gst_amount,
  total: priceItem(it).total,
}));
await supabase.from("bill_items").insert(billItemsPayload);

// Decrement stock for inventory items only
for (const it of inventoryItems) {
  await supabase.rpc("decrement_stock", { p_variantid: it.variantid, p_qty: it.quantity });
  // OR: UPDATE productsizecolors SET stock = stock - qty WHERE variantid = X
}
```

**Note on stock decrement:** Use `supabase.from("productsizecolors").update({ stock: stockMap[it.variantid].stock - it.quantity })` with an optimistic computed value, OR use a Supabase RPC for atomic `stock = stock - qty`. The RPC approach is safer (avoids read-then-write race). Check if the project already has such an RPC; if not, use the direct update with the pre-read value as a reasonable approximation for a single-user retail context.

### Pattern 2: Draft Update (BILL-02 + STOCK-02) — Delete-and-Reinsert

**What:** On update, the chosen approach (Claude's discretion) is delete-all-old-bill_items + insert-fresh. Stock delta is computed first using the pre-delete data.

```javascript
// 1. Fetch existing bill_items before deleting
const { data: existingItems } = await supabase
  .from("bill_items")
  .select("variantid, quantity")
  .eq("billid", billId)
  .not("variantid", "is", null);

// 2. Compute stock delta: old_qty restored, new_qty subtracted
// delta > 0 = restore stock; delta < 0 = subtract more
const deltaMap = {};
for (const old of existingItems) {
  deltaMap[old.variantid] = (deltaMap[old.variantid] || 0) + old.quantity; // restore
}
for (const it of inventoryItems) {
  deltaMap[it.variantid] = (deltaMap[it.variantid] || 0) - it.quantity; // subtract
}

// 3. Validate: new qty must not exceed available stock (current + restored delta)
// available = current_stock + (old_qty_for_this_variant)
// ...validate same way as new save but with adjusted available qty...

// 4. Delete old bill_items (CASCADE FK handles sub-items if any)
await supabase.from("bill_items").delete().eq("billid", billId);

// 5. Insert new bill_items
await supabase.from("bill_items").insert(billItemsPayload);

// 6. Update bills row
await supabase.from("bills").update({
  customerid: selectedCustomerId,
  notes,
  totalamount: computed.grandTotal,
  ...
  applied_codes: selectedCodes,
}).eq("billid", billId);

// 7. Apply stock deltas
for (const [variantid, delta] of Object.entries(deltaMap)) {
  if (delta === 0) continue;
  // delta > 0: restore (stock + delta), delta < 0: subtract (stock + delta = stock - abs)
  await supabase
    .from("productsizecolors")
    .update({ stock: currentStockMap[variantid] + delta })
    .eq("variantid", variantid);
}
```

### Pattern 3: Load for Edit (BILL-03)

**What:** When `billId` prop is non-null and dialog opens, fetch bill data and populate form state.

```javascript
// Load inside the open useEffect (or a separate billId useEffect)
useEffect(() => {
  if (!open || !billId) return;
  const loadBill = async () => {
    const { data: bill } = await supabase
      .from("bills")
      .select("customerid, notes, applied_codes")
      .eq("billid", billId)
      .single();

    const { data: billItems } = await supabase
      .from("bill_items")
      .select("*")
      .eq("billid", billId);

    setSelectedCustomerId(bill.customerid);
    setNotes(bill.notes || "");
    setSelectedCodes(bill.applied_codes || []);
    // Reconstruct items to match BillingForm item shape
    setItems(billItems.map(bi => ({
      _id: bi.bill_item_id.toString(),  // unique key for ItemTable
      variantid: bi.variantid,
      product_name: bi.product_name,
      product_code: bi.product_code,
      category: bi.category,
      quantity: bi.quantity,
      mrp: bi.mrp,
      alteration_charge: bi.alteration_charge || 0,
      quickDiscountPct: 0,  // item-level discount not stored as %, stored as flat; recalculate if needed
      gstRate: bi.gst_rate ?? 18,
    })));
  };
  loadBill();
}, [open, billId]);
```

**Critical shape concern:** `normalizeItem()` in `billUtils.js` reads `quickDiscountPct` from items to compute `itemDisc`. But `bill_items` stores `discount_total` as a flat amount, not a percentage. When loading for edit, either (a) set `quickDiscountPct: 0` and accept that re-display of item discount may differ, or (b) back-calculate the percentage: `quickDiscountPct = (discount_total / (mrp * quantity)) * 100`. Option (b) is more accurate for display. This is an implementation choice for the planner to decide.

### Pattern 4: BillTable Status Badge (D-03)

**What:** Replace raw `finalized` boolean with a status badge based on `paymentstatus`.

```javascript
// In BillTable select query — add paymentstatus
.select(
  "billid, customerid, orderdate, totalamount, gst_total, discount_total, paymentstatus",
  { count: "exact" }
)

// In table row render — replace the finalized cell
<td className="p-2 text-center">
  <Badge variant={
    b.paymentstatus === "finalized" ? "default" :
    b.paymentstatus === "cancelled" ? "destructive" : "secondary"
  }>
    {b.paymentstatus === "finalized" ? "Finalized" :
     b.paymentstatus === "cancelled" ? "Cancelled" : "Draft"}
  </Badge>
</td>
```

### Pattern 5: BillingPage — billId Prop Fix (Required for BILL-03)

**What:** BillingPage currently renders `<BillingForm key={activeBillId} open={dialogOpen} .../>` but does NOT pass `billId={activeBillId}`. This is a one-line gap.

```javascript
// BillingPage.js — add billId prop
<BillingForm
  key={activeBillId}
  billId={activeBillId}       // ← this line is missing
  open={dialogOpen}
  onOpenChange={setDialogOpen}
  onSubmit={handleFormSubmit}
/>
```

### Anti-Patterns to Avoid

- **Reading stock and writing separately without validation:** Never assume stock is unchanged between read and write. Always read stock, validate, then write in a single handler invocation.
- **Attempting manual rollback on partial failure:** Supabase does not support client-side transactions. `bill_items` ON DELETE CASCADE from `bills` means a failed `bill_items` insert after a successful `bills` insert leaves a dangling `bills` row. The plan should address this — options: (a) accept and surface the error, (b) clean up by deleting the bills row manually in the catch block.
- **Using `finalized` boolean for status display:** D-03 mandates using `paymentstatus` for the badge, not `finalized`. Do not conflate the two.
- **Loading discounts and bill data in the same useEffect:** The existing `useEffect` loads discounts when `open` changes. When `billId` is set, the loaded `applied_codes` should override auto-apply codes. The useEffect ordering must handle this: load discounts first, then load bill data and set `selectedCodes` from `applied_codes` (not from auto-apply logic).

---

## Schema Changes Required

### Migration: `applied_codes` column

A schema migration is required before Phase 1 can be implemented. Per project convention (MEMORY.md), this goes in a new file — not an inline edit to `initial_schema.sql`.

**File:** `schema/migration_01_applied_codes.sql`

```sql
-- Phase 1: Add applied_codes to bills table for discount code persistence
ALTER TABLE public.bills ADD COLUMN applied_codes text[] DEFAULT '{}';
```

**No other schema changes are in scope for Phase 1.** (`salespersons`, `bill_salespersons`, `payment_method`, `payment_amount` are all Phase 2.)

### Confirmed existing schema facts (HIGH confidence — verified from `initial_schema.sql`)

| Fact | Verified |
|------|----------|
| `bills.paymentstatus` is `character varying(20)` — accepts 'draft', 'finalized', 'cancelled' | Yes |
| `bills.finalized` is `boolean DEFAULT false` | Yes |
| `bills.applied_codes` does NOT exist yet | Yes — must be added via migration |
| `bill_items.variantid` is nullable UUID with FK to `productsizecolors.variantid` | Yes |
| `bill_items` has ON DELETE CASCADE from `bills` | Yes |
| `productsizecolors.stock` is `integer NOT NULL DEFAULT 0` | Yes |
| `discount_usage` table exists with `billid`, `customerid`, `code` FK columns | Yes |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Toast notifications | Custom alert/modal | `useToast()` already imported in BillingForm | Project-standard, already wired |
| Total amount calculations | Custom math in handler | `computeBillTotals(items, selectedCodes, allDiscounts)` in billUtils.js | Already handles all discount types, GST allocation, rounding |
| Per-item pricing | Inline arithmetic | `priceItem(it)` from billUtils.js | Handles alteration charges, quick discount, GST |
| Status badge styling | Custom CSS | Shadcn `Badge` component with variant prop | Consistent UI, already available |
| Supabase client initialization | Re-create client | `src/lib/supabaseClient.js` singleton | Already imports and configures client |

---

## Common Pitfalls

### Pitfall 1: Stock Check Race Condition
**What goes wrong:** Stock is read, validated, then bill is inserted — by the time stock is decremented another concurrent save (unlikely in retail but possible) could have consumed that stock.
**Why it happens:** No DB-level transaction from the client.
**How to avoid:** For this single-user retail context, client-side validation before write is acceptable. The pre-save read and write happen in the same async handler with no `await` gaps between validation and the first write. If atomic guarantees are needed, a Supabase DB function (RPC) could wrap the whole operation.
**Warning signs:** Stock going negative after concurrent saves.

### Pitfall 2: `applied_codes` Migration Not Run
**What goes wrong:** Insert to `bills` fails with "column applied_codes of relation bills does not exist".
**Why it happens:** The migration SQL has not been executed in the Supabase dashboard before the code lands.
**How to avoid:** The migration must be run first. The plan wave that implements BILL-01 must depend on the wave that creates the migration file. The migration file itself does not auto-apply — it requires manual execution in the Supabase dashboard (or Supabase CLI migration).
**Warning signs:** Supabase insert error referencing `applied_codes`.

### Pitfall 3: `billId` Not Passed to BillingForm
**What goes wrong:** Edit button opens a blank form instead of pre-populated form. `billId` is `null` inside BillingForm even when editing.
**Why it happens:** BillingPage passes `key={activeBillId}` but NOT `billId={activeBillId}` to BillingForm (verified by code inspection).
**How to avoid:** Fix is one line in BillingPage.js. This must be done as part of BILL-03 implementation.
**Warning signs:** `billId` prop is undefined in BillingForm even when editing a real bill.

### Pitfall 4: `useEffect` Load Order — Discounts Override Applied Codes
**What goes wrong:** When loading an existing draft for edit, the auto-apply discount logic in the existing `useEffect` sets `selectedCodes` from `auto_apply` discounts — overwriting the `applied_codes` restored from the bill.
**Why it happens:** The `open` useEffect sets `autoCodes` and calls `setSelectedCodes(autoCodes)` every time the dialog opens. The load-for-edit logic must run after this and override with `bill.applied_codes`.
**How to avoid:** Either separate the two useEffects (one for discounts, one for bill data — ensure bill load runs second), or merge them and conditionally set selectedCodes from `bill.applied_codes` when `billId` is set.
**Warning signs:** Applied discount codes reset to auto-apply defaults when opening an existing draft.

### Pitfall 5: `quickDiscountPct` Not Recoverable from `discount_total`
**What goes wrong:** Item-level discounts appear as 0% when loading a bill for edit, because `bill_items.discount_total` stores a flat amount, not a percentage.
**Why it happens:** `normalizeItem()` reads `quickDiscountPct` to compute the displayed discount. After loading from DB, this field is not present.
**How to avoid:** Back-calculate: `quickDiscountPct = (discount_total / (mrp * quantity)) * 100`. Round to 2 decimal places. If `mrp * quantity === 0`, set to 0.
**Warning signs:** Items show 0% item discount in the form even though they had discounts when originally saved.

### Pitfall 6: Dangling `bills` Row on Partial Failure
**What goes wrong:** `bills` row is inserted but `bill_items` insert fails — a draft bill with no items exists in the DB.
**Why it happens:** No client-side transaction support in Supabase JS client.
**How to avoid:** In the catch block, if `bills` insert succeeded but `bill_items` failed, delete the bills row: `await supabase.from("bills").delete().eq("billid", newBillId)`. This is a best-effort cleanup.
**Warning signs:** Bills appearing in BillTable with no items.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 1 is purely code and config changes. All dependencies (Supabase, React, Shadcn) are already installed and operational. The only external dependency is the Supabase project itself (already connected via `.env`).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Jest + React Testing Library (via Create React App) |
| Config file | None — CRA built-in |
| Quick run command | `npm test -- --watchAll=false --testPathPattern="billUtils"` |
| Full suite command | `npm test -- --watchAll=false` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BILL-01 | `computeBillTotals` output maps correctly to `bills` row fields | unit | `npm test -- --watchAll=false --testPathPattern="billUtils"` | Wave 0 |
| BILL-01 | `priceItem` computes subtotal, gst_amount, total correctly | unit | `npm test -- --watchAll=false --testPathPattern="billUtils"` | Wave 0 |
| BILL-02 | Stock delta calculation: old qty restored, new qty subtracted | unit | `npm test -- --watchAll=false --testPathPattern="stockDelta"` | Wave 0 |
| BILL-03 | `quickDiscountPct` back-calculation from flat discount_total | unit | `npm test -- --watchAll=false --testPathPattern="billUtils"` | Wave 0 |
| STOCK-01 | Only inventory items (variantid present) trigger stock decrement | unit | `npm test -- --watchAll=false --testPathPattern="billUtils"` | Wave 0 |
| STOCK-02 | Delta map correctly handles item removal and qty changes | unit | `npm test -- --watchAll=false --testPathPattern="stockDelta"` | Wave 0 |

**Note:** Supabase integration (actual DB writes) is manual-only. React component rendering tests require heavy mocking of Supabase; not required for this phase — unit tests on the pure utility functions (billUtils.js) provide the highest-value automated coverage.

### Sampling Rate

- **Per task commit:** `npm test -- --watchAll=false --testPathPattern="billUtils|stockDelta"`
- **Per wave merge:** `npm test -- --watchAll=false`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/admin/components/billing/__tests__/billUtils.test.js` — covers BILL-01, BILL-03, STOCK-01 (pure function tests for `computeBillTotals`, `priceItem`, `normalizeItem`, back-calc of `quickDiscountPct`)
- [ ] `src/admin/components/billing/__tests__/stockDelta.test.js` — covers BILL-02, STOCK-02 (stock delta map computation logic — extract helper function from handler for testability)

---

## Code Examples

### Verified: `computeBillTotals` Return Shape

```javascript
// Source: src/admin/components/billing/billUtils.js (read directly)
// Returns:
{
  itemsSubtotal,          // MRP total + alteration charges, before discounts/GST
  itemLevelDiscountTotal, // sum of per-item quickDiscount amounts
  overallDiscount,        // overall applied discount codes total
  taxableTotal,           // itemsSubtotal - itemLevelDiscountTotal - overallDiscount
  gstTotal,               // GST computed on taxableTotal, proportionally per item rate
  grandTotal,             // taxableTotal + gstTotal
}
// Mapping to bills insert:
// totalamount     → computed.grandTotal
// gst_total       → computed.gstTotal
// discount_total  → computed.itemLevelDiscountTotal + computed.overallDiscount
// taxable_total   → computed.taxableTotal
```

### Verified: `priceItem` Return Shape

```javascript
// Source: src/admin/components/billing/billUtils.js (read directly)
// Returns per-item:
{
  base,        // mrp * qty
  alteration,  // alteration_charge
  itemDisc,    // (base * quickDiscountPct) / 100
  afterDisc,   // base - itemDisc
  withCharges, // afterDisc + alteration  ← this is "subtotal" in bill_items
  subtotal,    // alias for withCharges
  gst_amount,  // (withCharges * gstRate) / 100
  total,       // withCharges + gst_amount
}
// Mapping to bill_items insert:
// discount_total    → priceItem(it).itemDisc
// subtotal          → priceItem(it).subtotal (= withCharges)
// gst_amount        → priceItem(it).gst_amount
// total             → priceItem(it).total
```

### Verified: BillingForm Item State Shape

```javascript
// Source: BillingForm.js + AddItemDialog usage pattern (inferred from ItemTable + normalizeItem)
// Each item in `items` array has at minimum:
{
  _id: string,             // client-side unique key (UUID or index)
  variantid: uuid | null,  // null for manual items
  product_name: string,
  product_code: string | null,
  category: string | null,
  quantity: number,
  mrp: number,
  alteration_charge: number,
  quickDiscountPct: number, // 0-100 percentage
  gstRate: number,          // default 18
}
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| `finalized` boolean for status display in BillTable | `paymentstatus` text field badge (D-03) | BillTable currently uses `finalized` — must be updated |
| QZ Tray for printing | `window.print()` (Phase 3) | Out of scope for Phase 1 |
| No stock reservation on draft | Stock subtracted immediately on Draft save | Core Phase 1 requirement |

---

## Open Questions

1. **Stock decrement method: direct update vs. RPC**
   - What we know: `productsizecolors.stock` is an integer. Direct update (`SET stock = stock - qty`) works in Supabase from the client.
   - What's unclear: Does the project have an existing RPC for stock operations? (Not visible in `initial_schema.sql` — RPCs are defined separately in Supabase.)
   - Recommendation: Use `supabase.from("productsizecolors").update({ stock: currentStock - qty })` with a pre-read value. Sufficient for single-user retail context. If concurrency becomes an issue, add an RPC in a later phase.

2. **`discount_usage` rows on Draft save**
   - What we know: `discount_usage` has a FK to `customers(customerid)` NOT NULL — it requires a customerid. BILL-01 does not require a customer.
   - What's unclear: Should `discount_usage` rows be inserted on Draft save, or only on Finalize?
   - Recommendation: Insert `discount_usage` only on Finalize (Phase 3). On Draft, only persist `applied_codes text[]` to `bills`. This avoids the nullable customer problem and matches the intent of "usage" (usage = completed transaction).

3. **Item `_id` field for loaded bill items**
   - What we know: BillingForm uses `_id` as a React key and for edit targeting (`it._id === id`). Freshly added items get a client-generated `_id`.
   - What's unclear: When loading from DB, what should `_id` be? `bill_item_id` (integer) or a new UUID?
   - Recommendation: Use `String(bi.bill_item_id)` as `_id` when loading from DB. This is stable, unique, and avoids UUID generation cost.

---

## Sources

### Primary (HIGH confidence)

- `src/admin/components/billing/BillingForm.js` — full source read, confirmed state shape, `handleSaveDraft` stub, prop interface
- `src/admin/components/billing/billUtils.js` — full source read, verified `computeBillTotals` and `priceItem` return shapes
- `src/admin/components/BillTable.js` — full source read, confirmed current columns and `onEdit` callback
- `src/admin/pages/BillingPage.js` — full source read, confirmed missing `billId` prop bug
- `schema/initial_schema.sql` — full source read, confirmed all table/column definitions for `bills`, `bill_items`, `productsizecolors`
- `.planning/phases/01-draft-stock-management/01-CONTEXT.md` — decisions D-01 through D-03 and canonical refs
- `.planning/ROADMAP.md` — Phase 1 implementation notes, field lists
- `.planning/REQUIREMENTS.md` — BILL-01 through STOCK-02 acceptance criteria

### Secondary (MEDIUM confidence)

- `.planning/STATE.md` — bill lifecycle confirmation, key file references

### Tertiary (LOW confidence)

- None — all findings are based on direct source file inspection.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — confirmed by reading source files directly; no new packages needed
- Schema facts: HIGH — read from `initial_schema.sql` directly
- Architecture patterns: HIGH — derived from existing codebase patterns in BillingForm, BillingPage, BillTable
- Pitfalls: HIGH — identified from direct code inspection (missing `billId` prop is a confirmed bug)
- Test framework: HIGH — CRA with Jest confirmed from `package.json` scripts

**Research date:** 2026-03-28
**Valid until:** 2026-04-28 (stable schema + no planned dependency upgrades)
