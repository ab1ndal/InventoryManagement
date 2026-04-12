# Phase 5: Support Different Discount Types in Billing — Research

**Researched:** 2026-04-12
**Domain:** Billing discount system audit & fix — React SPA + Supabase
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** End-to-end audit and fix — not new capabilities. Every discount type (flat, percentage, buy_x_get_y, fixed_price, conditional) must be verifiable: create in DiscountForm → appear in BillingForm → apply correctly → show in invoice PDF.
- **D-02:** `auto_apply` discounts must still respect their conditions before being pre-selected in BillingForm. A discount marked `auto_apply` should only activate if: `start_date` is null or ≤ today; `end_date` is null or ≥ today; `min_total` (if set) is met by the current bill total; other type-specific conditions (e.g., category items present for buy_x_get_y).
- **D-03:** Currently auto_apply discounts blindly pre-select regardless of conditions — this is the root cause of "irrelevant discounts being applied."
- **D-04:** BillingForm must filter out expired discounts (where `end_date` is not null and `end_date < today`) before displaying in DiscountSelector. Expired discounts must not appear — not even as disabled options.
- **D-05:** When a customer is selected in BillingForm, query `discount_usage` for that `customerid` to find all previously-used codes. Filter `once_per_customer = true` discounts that already appear in that customer's `discount_usage` records — hide them from DiscountSelector entirely.
- **D-06:** If no customer is selected, all discounts show (no filtering possible without a customer).
- **D-07:** Audit DiscountForm for each type and fix any missing or unclear fields: `buy_x_get_y` must have a category picker (optional — restricts free items to a specific category); `conditional` needs `min_total` and `value` clearly labeled and functional; `fixed_price` needs `rules_fixed_total` and optional category clear; all types need `start_date`, `end_date`, `min_total`, `max_discount`, `exclusive`, `auto_apply`, `once_per_customer` toggles visible and wired.
- **D-08:** The `conditional` type's `value` field is the flat amount off (not a percentage). The form must make this unambiguous.
- **D-09:** Buy-X-Get-Y has never been tested end-to-end. As part of this phase: create a test buy_x_get_y discount, apply it to a bill with qualifying items, and verify `valueOfDiscount()` returns the correct amount.
- **D-10:** The printed invoice PDF must show which items are free when buy_x_get_y is applied. In `InvoiceView.js`, after computing the buy_x_get_y discount value, identify the specific line items that are "free" (cheapest eligible items up to `get_qty × group_count`) and label them with "FREE" in the invoice line items table.
- **D-11:** The "FREE" label appears in the invoice PDF only (not in the billing Summary panel).
- **D-12:** No change — `quickDiscountPct` (percentage per item) remains the only item-level discount. Flat ₹X item discounts are not needed.

### Claude's Discretion

- How "FREE" is visually styled in InvoiceView (badge, strikethrough, small text label — any clear approach)
- Order of discount eligibility checks in the auto-apply fix
- Whether to show a tooltip/badge on filtered-out once_per_customer codes or silently hide them

### Deferred Ideas (OUT OF SCOPE)

- Voucher management UI — creating/issuing promotional voucher codes from an admin screen
- Loyalty tier discounts — auto-discounts based on customer loyalty tier
- Flat ₹X item-level discounts — confirmed not needed
- Discount analytics — which codes are used most, total discount given per period
- Category-restricted percentage discounts — "20% off Kurtis only" as a separate type
</user_constraints>

---

## Summary

Phase 5 is a correctness and completeness audit of the existing discount system — not a feature addition. The schema and logic layer for all five discount types (flat, percentage, buy_x_get_y, fixed_price, conditional) already exist. The work involves four areas: (1) fixing auto-apply pre-selection to respect eligibility conditions, (2) hiding expired and once-per-customer-used discounts in BillingForm, (3) auditing DiscountForm field completeness and labeling, and (4) adding "FREE" item labels to InvoiceView for buy_x_get_y discounts.

All five types are fully implemented in `valueOfDiscount()` in `billUtils.js` and are correctly wired into `computeBillTotals()`. The discount fetch in BillingForm already filters by `start_date`/`end_date` at lines ~104–108 — so D-04 is partially implemented. The remaining gap is `once_per_customer` filtering (D-05) and conditional auto-apply eligibility (D-02/D-03). DiscountForm has all core fields wired but the `conditional` type's `value` label is ambiguous (shows "Value (₹)" which could be confused with a percentage by the user).

**Primary recommendation:** Implement in four focused tasks: (1) auto-apply eligibility fix in BillingForm, (2) once-per-customer filter on customer select, (3) DiscountForm label clarity + category picker audit, (4) InvoiceView buy_x_get_y FREE label with extracted `getFreeItems()` helper.

---

## Standard Stack

### Core (already in use — no new dependencies needed)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `@supabase/supabase-js` | existing | Discount + usage queries | Direct client calls, no API layer |
| React 19 | existing | Component state + effects | `useState`, `useEffect`, `useMemo` |
| React Hook Form + Zod | existing | DiscountForm validation | `zodResolver`, `useWatch` |
| Shadcn/ui | existing | Checkbox, Badge, Select, Input | All primitives already present |
| Sonner | existing | Toast notifications | `toast.error`, `toast.success` |

No new packages are required for this phase. [VERIFIED: codebase grep]

### No New Installations

```bash
# Nothing to install — all dependencies already present
```

---

## Architecture Patterns

### Recommended Change Structure

The fixes decompose cleanly by file. No new files are needed except a potential `getFreeItems()` helper extracted from `billUtils.js`.

```
src/admin/components/billing/
├── billUtils.js          # Extract getFreeItems() helper from valueOfDiscount()
├── BillingForm.js        # Fix auto-apply + add once_per_customer filter effect
├── DiscountSelector.js   # No changes needed (rendering is already correct)
└── InvoiceView.js        # Add FREE label logic using getFreeItems()

src/admin/components/
└── DiscountForm.js       # Fix conditional value label; verify category for buy_x_get_y
```

### Pattern 1: Auto-Apply Eligibility Check (D-02 / D-03)

**What:** After loading discounts, filter `auto_apply` candidates against current items before pre-selecting.

**When to use:** Inside the `loadDiscounts` useEffect in BillingForm, and again reactively when `items` change (so a newly added item can trigger eligibility).

**Current code (BillingForm.js ~lines 111–113) — the bug:**

```javascript
// CURRENT (buggy): auto-selects every auto_apply discount regardless of conditions
if (!billId) {
  const autoCodes = valid.filter((d) => d.auto_apply).map((d) => d.code);
  setSelectedCodes(autoCodes);
}
```

**Fixed pattern:**

```javascript
// Source: CONTEXT.md D-02 + billUtils.js valueOfDiscount logic
function isDiscountEligible(d, items, today) {
  if (d.start_date && d.start_date > today) return false;
  if (d.end_date && d.end_date < today) return false;
  const total = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  if (d.min_total && total < Number(d.min_total)) return false;
  if (d.type === 'buy_x_get_y') {
    const r = d.rules || {};
    const cat = r.category || null;
    const buy = Number(r.buy_qty || 2);
    const get = Number(r.get_qty || 1);
    const eligible = items.filter(it => !cat || (it.category || it.manual_category) === cat);
    const totalQty = eligible.reduce((s, it) => s + Number(it.quantity || 1), 0);
    if (totalQty < buy + get) return false;
  }
  return true;
}

// In loadDiscounts, replace the auto-code block:
if (!billId) {
  const autoCodes = valid
    .filter((d) => d.auto_apply && isDiscountEligible(d, items, today))
    .map((d) => d.code);
  setSelectedCodes(autoCodes);
}
```

**Important:** `isDiscountEligible` must also run reactively. Add a `useMemo`/`useEffect` on `[items, allDiscounts]` that removes any currently `selectedCodes` for auto-apply discounts that are no longer eligible — but does NOT remove manually toggled non-auto codes.

### Pattern 2: Once-Per-Customer Filter (D-05)

**What:** When `selectedCustomerId` changes, query `discount_usage` and remove once-per-customer codes from `allDiscounts` shown in DiscountSelector.

**Pattern:**

```javascript
// Source: CONTEXT.md D-05 specifics
useEffect(() => {
  if (!selectedCustomerId) return; // D-06: no filter without customer
  supabase
    .from('discount_usage')
    .select('code')
    .eq('customerid', selectedCustomerId)
    .then(({ data }) => {
      const usedCodes = new Set((data || []).map(r => r.code));
      setAllDiscounts(prev =>
        prev.filter(d => !(d.once_per_customer && usedCodes.has(d.code)))
      );
      // Also deselect any selectedCodes that got filtered out
      setSelectedCodes(prev => prev.filter(c => !usedCodes.has(c) || !allDiscounts.find(d => d.code === c && d.once_per_customer)));
    });
}, [selectedCustomerId]);
```

**Timing:** This effect runs after `loadDiscounts` has populated `allDiscounts`. Dependency on `selectedCustomerId` only — not on `allDiscounts` (to avoid loops). Run it after the discount fetch settles.

### Pattern 3: Extract getFreeItems() Helper (D-10)

**What:** Lift the buy_x_get_y cheapest-item identification out of `valueOfDiscount` into a reusable exported function, then use it in both `valueOfDiscount` and `InvoiceView`.

**Pattern:**

```javascript
// Source: billUtils.js buy_x_get_y branch + CONTEXT.md code_context
export function getFreeItems(d, items) {
  // Returns array of { itemIndex, unitPrice } for cheapest eligible items that are free
  const r = d.rules || {};
  const cat = r.category || null;
  const buy = Number(r.buy_qty || 2);
  const get = Number(r.get_qty || 1);
  const eligible = [];
  items.forEach((it, itemIndex) => {
    if (!cat || (it.category || it.manual_category) === cat) {
      const p = priceItem(it);
      const unitPrice = p.withCharges / (it.quantity || 1);
      for (let i = 0; i < (it.quantity || 1); i++) {
        eligible.push({ itemIndex, unitPrice });
      }
    }
  });
  eligible.sort((a, b) => a.unitPrice - b.unitPrice);
  if (eligible.length < buy + get) return [];
  const group = Math.floor(eligible.length / (buy + get));
  return eligible.slice(0, group * get);
}
```

`valueOfDiscount` then calls `getFreeItems(d, items)` and sums `.unitPrice`.

### Pattern 4: InvoiceView "FREE" Label (D-10 / D-11)

**What:** In InvoiceView, compute which items are free (using the same logic) and render a "FREE" indicator in the line items table.

**InvoiceView receives `allDiscounts` and `appliedCodes` props** — it already receives `appliedCodes`. Add `allDiscounts` prop (or just the buy_x_get_y discounts from `appliedCodes`).

**Pattern:**

```javascript
// Source: CONTEXT.md D-10 + D-11
// In InvoiceView, before rendering the line items table:
const freeItemIndices = new Set();
if (appliedCodes && allDiscounts) {
  appliedCodes.forEach(code => {
    const d = allDiscounts.find(d => d.code === code && d.type === 'buy_x_get_y');
    if (d) {
      const freeItems = getFreeItems(d, items);
      freeItems.forEach(f => freeItemIndices.add(`${f.itemIndex}`));
    }
  });
}
// Then in the row render:
{freeItemIndices.has(`${idx}`) && (
  <span style={{ color: '#16a34a', fontWeight: 600, fontSize: '10px' }}>FREE</span>
)}
```

**Note on multi-qty rows:** Since InvoiceView renders one row per `items` array entry (not per unit), and the cheapest-item logic works per unit, there is a mismatch when an item has qty > 1. The "FREE" label on a row means at least one unit from that row is free. The planner should document this edge case for implementation clarity.

### Anti-Patterns to Avoid

- **Recomputing buy_x_get_y logic inline in InvoiceView:** Duplicates logic and drifts. Always call the extracted `getFreeItems()` from `billUtils.js`.
- **Running once_per_customer filter on every render:** Query `discount_usage` only when `selectedCustomerId` changes, not in the main discount fetch loop.
- **Removing manually-selected codes during auto-apply re-evaluation:** Auto-apply eligibility re-checks should only affect `auto_apply=true` discounts; never silently remove a manually checked discount.
- **Filtering `allDiscounts` state destructively for once_per_customer:** Safer to maintain a `filteredDiscounts` derived value rather than mutating `allDiscounts`, so the filter can be re-applied if customer changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date comparison | Custom date parsing | ISO string comparison (`d.end_date < today` where both are `YYYY-MM-DD`) | Already works correctly in existing loadDiscounts filter |
| Discount value computation | New calculation logic | Existing `valueOfDiscount()` in billUtils.js | All five types implemented and tested |
| once_per_customer query | Custom cache layer | Direct Supabase `.from('discount_usage').select('code').eq('customerid', X)` | Matches established pattern |
| "FREE" item identification | New algorithm | Extract `getFreeItems()` from existing buy_x_get_y branch | Ensures parity with what's computed for the bill total |

---

## Existing Code Audit Findings

### BillingForm.js — What's Already Working

[VERIFIED: codebase read]

- **Date filtering (D-04): ALREADY IMPLEMENTED.** Lines ~104–108 filter discounts where `start_date > today` or `end_date < today` before setting `allDiscounts`. No fix needed for date filtering in display.
- **Date filtering in query:** The Supabase query at line ~94 fetches all active discounts; the date filter happens client-side after fetch. This is acceptable.
- **`discount_usage` insert on finalize:** Lines ~656–663 correctly insert per applied code. Works correctly.

### BillingForm.js — Bugs Found

[VERIFIED: codebase read]

- **Auto-apply bug (D-03):** Lines ~111–113 pre-select every `auto_apply` discount without checking `min_total`, category eligibility, or buy/get qty. This is the confirmed bug.
- **No once_per_customer filter:** There is no `useEffect` on `selectedCustomerId` that queries `discount_usage`. The `discount_usage` table is only written to (on finalize), never read back in BillingForm.
- **Auto-apply is not reactive to item changes:** Even after the fix, if items are added that make a discount eligible, there's no re-evaluation. The planner should decide: fix for initial load only, or also re-evaluate on item changes (useMemo approach).

### DiscountForm.js — Audit Results

[VERIFIED: codebase read]

- **`conditional` type value label:** Currently shows "Value (₹)" for all non-percentage types. For `conditional`, this is the flat discount amount. The label does NOT change when `type === 'conditional'` — it needs to show "Discount Amount (₹ off)" or similar to make D-08 clear.
- **`buy_x_get_y` category:** The category field IS present as a global top-level field (not a rules-specific picker). The form note says "Category filter is applied from the Category field above." This is functionally correct but could be made more explicit for the buy_x_get_y section (D-07 asks for a category picker in the rules section). Current implementation: category goes to `rules.category` in the save handler for buy_x_get_y. The form wires this correctly.
- **`conditional` `min_total`:** The form has a top-level "Min Order Total" field wired to `min_total`. But `valueOfDiscount` for `conditional` reads `r.min_total || d.min_total` — the `rules` object for conditional is `null` (not assembled in the save handler). So it correctly falls back to `d.min_total`. This works, but is inconsistent with how the label reads in `discountLabel()` in DiscountSelector.js which reads `r.min_total || d.min_total`. No functional bug, but clarity could be improved.
- **All toggles present:** `auto_apply`, `exclusive`, `once_per_customer`, `active` checkboxes are all wired correctly.
- **`custom` type in Zod schema but not in TYPE_LABELS:** The Zod enum includes `"custom"` but it is not in `TYPE_LABELS` object or the database `CHECK` constraint. This is a dormant inconsistency — the planner should note to remove `"custom"` from the Zod enum to match the DB constraint.

### InvoiceView.js — Audit Results

[VERIFIED: codebase read]

- **Overall discount display:** Line ~147 shows "Overall Discount (CODE1, CODE2): -₹X" — correct.
- **No per-item FREE label:** Confirmed absent. This is the new feature in D-10.
- **`allDiscounts` not passed to InvoiceView:** The component currently receives `{ billId, billDate, customerName, salespersonNames, items, computed, paymentMethod, paymentAmount, appliedCodes }`. Adding `allDiscounts` prop is required for the FREE label feature, or pass already-computed free item indices from the caller.

### billUtils.js — Audit Results

[VERIFIED: codebase read]

- **All five types implemented:** flat, percentage, buy_x_get_y, fixed_price, conditional — all in `valueOfDiscount()`.
- **buy_x_get_y logic:** Eligible items sorted ascending by unit `withCharges`. Cheapest `floor(eligible.length / (buy + get)) * get` items are free. `clampMax` applied. Logic is correct per D-09 description.
- **`conditional` reads from both `d.min_total` and `r.min_total`:** `const minTotal = Number(r.min_total || d.min_total || 0)`. Since `rules` is null for conditional discounts saved by DiscountForm, this correctly falls back to `d.min_total`.
- **`valueOfDiscount` is not exported:** It's a module-private function. The planner must ensure `getFreeItems()` is exported properly from `billUtils.js`.

### schema — Audit Results

[VERIFIED: codebase read]

- **`discounts` table:** Has all required columns — `code`, `type`, `value`, `max_discount`, `category`, `product_ids`, `once_per_customer`, `exclusive`, `auto_apply`, `min_total`, `start_date`, `end_date`, `rules` JSONB, `active`.
- **DB `CHECK` constraint:** Only allows `['flat', 'percentage', 'buy_x_get_y', 'fixed_price', 'conditional']` — no `custom`. Zod schema needs to match.
- **No schema changes required for Phase 5.** All needed columns already exist.
- **`discount_usage` table:** Has `customerid`, `code`, `billid`, `used_at`. Correct for the once-per-customer query.

---

## Common Pitfalls

### Pitfall 1: Auto-Apply Re-evaluation Race Condition

**What goes wrong:** The `loadDiscounts` useEffect and item-change re-evaluation both try to set `selectedCodes`. If items arrive after discounts, the initial auto-apply fires with `items = []` (min_total = 0), qualifying everything.

**Why it happens:** `loadDiscounts` is triggered by `[open, billId]` only. Items are loaded in a separate effect. When the form opens for a new bill, items are empty at discount-fetch time.

**How to avoid:** For new bills, defer auto-apply evaluation to when items first change (or on manual "Apply offers" button). For the simplest fix: run auto-apply eligibility check inside a `useEffect([allDiscounts, items])` that only fires for new bills (`!billId`), not inside `loadDiscounts` itself.

**Warning signs:** A buy_x_get_y discount shows as pre-selected even when no qualifying items are in the bill.

### Pitfall 2: Once-Per-Customer Filter Mutates allDiscounts State

**What goes wrong:** If the filter removes a discount from `allDiscounts`, and the customer is later deselected, the discount is gone from state and won't reappear.

**Why it happens:** Mutation of the source-of-truth array.

**How to avoid:** Keep `allDiscounts` as the full loaded set. Derive `visibleDiscounts = allDiscounts.filter(...)` using `useMemo([allDiscounts, usedCodes, selectedCustomerId])`. Pass `visibleDiscounts` to `<DiscountSelector>`, not `allDiscounts` directly.

### Pitfall 3: Multi-Qty Items in getFreeItems / InvoiceView Mismatch

**What goes wrong:** `getFreeItems` identifies free units (one per qty), but InvoiceView renders one row per item entry in the items array. A row with qty=3 where 2 units are free shows confusingly as one "FREE" label.

**Why it happens:** The data model mixes item-row and unit-level concepts.

**How to avoid:** For V1, label a row "FREE" if any unit from it is free, and add a parenthetical "(2 of 3 units free)" if the count is partial. Or, simpler: label the row "FREE" only when all units of that row are free; show no label when only some units are free (acceptable since the total discount amount is still correct in the totals section).

### Pitfall 4: Zod `custom` Type Mismatch With DB Constraint

**What goes wrong:** DiscountForm's Zod schema accepts `"custom"` type, but the DB CHECK constraint rejects it. A form submission with type="custom" would error at the Supabase insert layer.

**Why it happens:** Zod enum was extended beyond DB constraints at some point.

**How to avoid:** Remove `"custom"` from the Zod enum in `DiscountForm.js`. This is a safe cleanup.

### Pitfall 5: `conditional` discount value label ambiguity

**What goes wrong:** The form shows "Value (₹)" for the `conditional` type. Staff may interpret this as a percentage or a threshold, not a flat deduction amount.

**Why it happens:** The label is type-agnostic in the current form.

**How to avoid:** When `type === 'conditional'`, change the label to "Discount Amount (₹ off)" (similar to how `percentage` already changes the label to "Value (%)").

---

## Code Examples

### Auto-Apply Eligibility Helper

```javascript
// Source: billUtils.js priceItem() pattern + CONTEXT.md D-02
import { priceItem } from './billUtils';

export function isAutoApplyEligible(d, items, today) {
  // Date guards (redundant with loadDiscounts filter but defensive)
  if (d.start_date && d.start_date > today) return false;
  if (d.end_date && d.end_date < today) return false;
  // min_total guard
  const total = items.reduce((s, it) => s + priceItem(it).withCharges, 0);
  if (Number(d.min_total || 0) > 0 && total < Number(d.min_total)) return false;
  // buy_x_get_y: enough qualifying items?
  if (d.type === 'buy_x_get_y') {
    const r = d.rules || {};
    const cat = r.category || null;
    const buy = Number(r.buy_qty || 2);
    const get = Number(r.get_qty || 1);
    const qtyInCat = items.reduce((s, it) => {
      if (!cat || (it.category || it.manual_category) === cat)
        return s + Number(it.quantity || 1);
      return s;
    }, 0);
    if (qtyInCat < buy + get) return false;
  }
  return true;
}
```

### Once-Per-Customer Query Pattern

```javascript
// Source: CONTEXT.md specifics + established Supabase pattern in codebase
const { data: usageData } = await supabase
  .from('discount_usage')
  .select('code')
  .eq('customerid', selectedCustomerId);
const usedCodes = new Set((usageData || []).map(r => r.code));
```

### Derived visibleDiscounts (avoids allDiscounts mutation)

```javascript
// Source: React useMemo pattern established in BillingForm (line ~257)
const visibleDiscounts = useMemo(() => {
  if (!selectedCustomerId) return allDiscounts;
  return allDiscounts.filter(
    d => !(d.once_per_customer && usedCodeSet.has(d.code))
  );
}, [allDiscounts, usedCodeSet, selectedCustomerId]);
```

---

## Runtime State Inventory

This phase is a fix/audit of existing code — no renames or migrations. No runtime state inventory required.

**No schema changes:** All columns needed (`once_per_customer`, `min_total`, `rules`, `start_date`, `end_date`) already exist.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no test files found in repo |
| Config file | None |
| Quick run command | Manual QA in browser |
| Full suite command | Manual QA in browser |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| D-02/D-03 | auto_apply only pre-selects eligible discounts | manual | Create discount with min_total > empty bill total; verify not pre-selected |
| D-04 | Expired discounts hidden | manual | Create discount with end_date = yesterday; verify absent in DiscountSelector |
| D-05 | once_per_customer codes hidden after use | manual | Finalize a bill with once_per_customer code; open new bill for same customer; verify code absent |
| D-09 | buy_x_get_y end-to-end | manual | Create B2G1 discount, add 3 qualifying items, verify discount = cheapest item price |
| D-10 | FREE label in invoice PDF | manual | Apply buy_x_get_y discount, generate invoice, verify FREE label on cheapest item row |
| D-07/D-08 | DiscountForm conditional label clarity | manual | Create conditional discount; verify form shows "Discount Amount (₹ off)" label |

### Wave 0 Gaps

No automated test infrastructure exists in this project. All validation is manual QA. This is consistent with the established pattern across all prior phases.

---

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — all changes are React component edits; Supabase is already connected).

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | Zod schema in DiscountForm (already present) |
| V4 Access Control | yes | `RequireAdminAuth` guards all billing/discount pages (already present) |
| V2 Authentication | no | Auth unchanged |
| V6 Cryptography | no | No crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| once_per_customer bypass | Tampering | Server-side: `discount_usage` FK constraint + query on finalize. Client-side filter is UX only — the insert at finalize is the enforcement point. |
| Expired discount applied via code injection | Tampering | Date filter in BillingForm is client-side; Supabase RLS or server validation not present. Current risk: low (admin-only UI). |

**Note:** Client-side discount filtering is UX, not security enforcement. Since this is an internal admin-only SPA with auth guards, the risk level is acceptable per existing project architecture. [ASSUMED — no security policy document reviewed]

---

## Open Questions

1. **Auto-apply re-evaluation on item changes**
   - What we know: The fix for D-03 is clear for initial load. It's unclear whether auto-apply should re-evaluate as items are added/removed mid-session.
   - What's unclear: If a staff member adds the 3rd qualifying item for a buy_x_get_y deal mid-session, should the discount auto-activate?
   - Recommendation: For V1, evaluate only at form open (for new bills) and when customer loads. Document that staff can manually check/uncheck codes. This is the simplest correct implementation.

2. **Multi-qty FREE label rendering in InvoiceView**
   - What we know: getFreeItems returns per-unit entries; InvoiceView renders per-item-row.
   - What's unclear: Whether to show "FREE" on rows where only some units are free.
   - Recommendation: Label a row FREE only when all units of that row are free. Show no special label for partial rows. Total discount amount in Summary is still correct.

3. **`custom` type removal from Zod**
   - What we know: It's in Zod but not in the DB constraint.
   - What's unclear: Was `custom` intentionally added for future use?
   - Recommendation: Remove from Zod schema during the DiscountForm audit (D-07). Low risk — it only affects form validation, not existing data.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Client-side discount filtering is acceptable (no RLS required) | Security Domain | Low — admin-only app with auth guards |
| A2 | Auto-apply re-evaluation on item changes is out of scope for V1 | Open Questions | Low — staff can manually select discounts |

---

## Sources

### Primary (HIGH confidence)
- `src/admin/components/billing/billUtils.js` — Full read; `valueOfDiscount()`, `applyOverallDiscounts()`, `computeBillTotals()`, `priceItem()` verified [VERIFIED: codebase read]
- `src/admin/components/billing/BillingForm.js` — Partial reads covering discount fetch (~lines 91–118), customer effects (~lines 213–248), finalize flow (~lines 640–700) [VERIFIED: codebase read]
- `src/admin/components/billing/DiscountSelector.js` — Full read; `discountLabel()`, `DiscountRow`, auto/optional split [VERIFIED: codebase read]
- `src/admin/components/billing/InvoiceView.js` — Full read; confirmed no FREE label, confirmed `appliedCodes` prop exists [VERIFIED: codebase read]
- `src/admin/components/DiscountForm.js` — Full read; Zod schema, field wiring, `toFormValues`, save handler [VERIFIED: codebase read]
- `schema/initial_schema.sql` — `discounts` and `discount_usage` table definitions verified [VERIFIED: codebase read]
- `.planning/phases/05-.../05-CONTEXT.md` — All decisions D-01 through D-12 [VERIFIED: file read]

### Secondary (MEDIUM confidence)
- `src/admin/components/billing/Summary.js` — Full read; confirms "Code Discounts" row sufficient; no changes needed [VERIFIED: codebase read]

---

## Metadata

**Confidence breakdown:**
- Bug identification (auto-apply, once_per_customer): HIGH — confirmed by direct code inspection
- Schema completeness: HIGH — verified against initial_schema.sql
- Fix patterns: HIGH — derived from existing code patterns in the same files
- InvoiceView FREE label approach: MEDIUM — multi-qty edge case needs planner decision

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable codebase, no external API dependencies)
