# Phase 6: Exchange and Returns — Research

**Researched:** 2026-04-21
**Domain:** React SPA / Supabase — partial-return flow, store credit, restock, PDF generation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Exchange initiated from `ExchangePage` (`src/admin/pages/ExchangePage.js` — stub). Bill search (by bill_number or customer name) is the sole entry point.
- **D-02:** Only `paymentstatus = 'finalized'` bills are eligible. Draft and cancelled excluded.
- **D-03:** No BillTable action button for exchange this phase.
- **D-04:** Staff can return any subset of items, including partial quantities per line item (qty input: 0 → max).
- **D-05:** Manual items (no variantid) are returnable. New `stock` column added to `manual_items` via migration. On return: `manual_items.stock += returned_qty`.
- **D-06:** Inventory restock: `UPDATE productsizecolors SET stock = stock + returned_qty WHERE variantid = X`.
- **D-07:** Per returned item, insert row into `exchanges` table: `original_bill_item_id`, `quantity`, `reason` (optional), `customerid`, `credit_amount`. `voucher_id` left null.
- **D-08:** `credit_amount` per item = `(mrp × returned_qty) - item_discount_proportional + alteration_charge_proportional`. GST included in credit. Total = sum of per-item credit_amounts.
- **D-09:** `customers.store_credit += total_credit_amount`. No vouchers table row.
- **D-10:** Store credit added immediately on exchange confirmation, before new bill opens. If new bill abandoned, credit remains on account.
- **D-11:** Reuse `ReturnReceiptView` (A5). Extend with `mode` prop to distinguish cancellation vs exchange receipt.
- **D-12:** Exchange receipt content: store header, original bill number, date of exchange, customer name, table of returned items (name, size, color, qty, credit value), total credit, note: "Store credit of ₹X has been added to your account."
- **D-13:** PDF via html2canvas + jsPDF + `generateInvoicePdf.js`. Opens in new tab. NOT saved to Supabase Storage.
- **D-14:** After exchange confirmed and PDF printed, open BillingForm with exchange credit pre-applied as "Additional Discount" labeled `"Return Credit — Bill #BC25001"`.
- **D-15:** `credit_amount` = total exchange credit. Deduction order: item discounts → discount codes → promo voucher → store credit → additional discount (exchange credit). Floor at 0.
- **D-16:** "Additional Discount" is local state in BillingForm — NOT a `discounts` row, NOT a `vouchers` row. Tracked as `exchangeCredit: { amount, label }`. Applied in `computeBillTotals()` or as post-computation deduction (same pattern as `appliedStoreCredit`).
- **D-17:** New bill pre-fills same customer as original bill. Staff can change.
- **D-18:** If staff close BillingForm without finalizing, no further action — `customers.store_credit` already has the credit.
- **D-19:** Add `stock integer not null default 1` to `manual_items` via `schema/migration_14_manual_items_stock.sql`.
- **D-20:** No other schema migrations needed — `exchanges` table already has all required columns.

### Claude's Discretion

- Bill search UI on ExchangePage (search input style, results display)
- Confirmation dialog copy and layout for exchange summary before confirming
- How to handle exchange of a bill with no associated customer (exchange proceeds; store credit skipped; PDF still prints without customer name)
- Error handling for partially-failed restock operations

### Deferred Ideas (OUT OF SCOPE)

- BillTable shortcut button to ExchangePage
- Saving return receipt PDF to Supabase Storage
- Exchange history view per customer
- Reason code dropdown (currently free text)

</user_constraints>

---

## Summary

Phase 6 implements a partial-item return + exchange workflow on ExchangePage. The data layer is almost entirely ready: `exchanges` table exists, `customers.store_credit` column exists, restock patterns exist in BillTable, PDF generation pattern exists in ReturnReceiptView + generateInvoicePdf. The only schema gap is `manual_items.stock` (migration_14).

The main implementation work is: (1) ExchangePage UI — bill search, item selection with qty inputs, confirmation dialog, orchestration; (2) minor extension of ReturnReceiptView for exchange mode; (3) adding `exchangeCredit` state + deduction to BillingForm/billUtils/Summary; (4) opening BillingForm from ExchangePage with pre-loaded customer + exchange credit.

Opening BillingForm from ExchangePage requires routing coordination. BillingForm is currently a Dialog opened from BillingPage state. ExchangePage lives at `/admin/exchanges`. The navigation path must pass exchange credit data to BillingPage — cleanest approach: `useNavigate` with `state` to `/admin/bills`, where BillingPage reads `location.state` and auto-opens BillingForm with the exchangeCredit prop.

**Primary recommendation:** Build ExchangePage as a self-contained page. After confirmation, navigate to `/admin/bills` with route state carrying `{ openNewBill: true, exchangeCredit: { amount, label }, customerId }`. BillingPage reads this on mount and auto-opens BillingForm.

---

## Project Constraints (from CLAUDE.md)

- React 19 SPA via Create React App
- Supabase (PostgreSQL + Auth) — direct client calls from components, no API layer
- All data access via `@supabase/supabase-js`
- Shadcn/ui components + Tailwind CSS (primary: `#0066cc`)
- Sonner for toasts
- Path alias `@/*` maps to `src/*`
- No QZ Tray — browser PDF print only
- Schema changes go in `schema/migration_*.sql` files, not inline edits to initial_schema.sql [VERIFIED: MEMORY.md]
- Query graphify graph before reading raw files (project convention — followed in this session)

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | project's current | DB reads/writes, direct client | Already wired; all data flows through it |
| `html2canvas` | project's current | DOM-to-canvas for PDF capture | Used by generateInvoicePdf already |
| `jspdf` | project's current | PDF generation from canvas | Used by generateInvoicePdf already |
| `react-router-dom` | project's current | Navigation with state passing | Used throughout; `useNavigate`+`useLocation` for cross-page data |
| `sonner` | project's current | Toast notifications | Used everywhere in admin |

No new dependencies required. [VERIFIED: read package files and existing code]

**Installation:** None needed.

---

## Architecture Patterns

### Recommended File Structure Changes

```
src/admin/pages/
└── ExchangePage.js          # stub → full implementation

src/admin/components/billing/
├── ReturnReceiptView.js     # extend with mode prop
├── BillingForm.js           # add exchangeCredit state + prop
├── Summary.js               # add exchange credit deduction row
└── billUtils.js             # exchange credit deduction in computeBillTotals

schema/
└── migration_14_manual_items_stock.sql   # new
```

### Pattern 1: Bill Search on ExchangePage

**What:** Text input for bill_number OR customer name. On submit, query `bills` with `.eq('paymentstatus', 'finalized')`. For customer name search, join customers or do a two-step: find matching customerids first, then bills.

**Query approach:**
```javascript
// Search by bill_number (exact or ilike)
supabase
  .from('bills')
  .select('billid, bill_number, orderdate, customerid, customers(first_name, last_name), totalamount')
  .eq('paymentstatus', 'finalized')
  .ilike('bill_number', `%${query}%`)

// OR search by customer name (two-step or relationship filter)
supabase
  .from('bills')
  .select('billid, bill_number, orderdate, customerid, customers!inner(first_name, last_name)')
  .eq('paymentstatus', 'finalized')
  .or(`customers.first_name.ilike.%${query}%,customers.last_name.ilike.%${query}%`)
```
[ASSUMED] — Supabase filter on related table columns via `!inner` join may require PostgREST syntax verification; simpler two-step query is safer.

### Pattern 2: Item Selection with Partial Quantity

**What:** After bill loaded, fetch `bill_items` for that bill. Check already-returned quantities by querying `exchanges` for `original_bill_item_id` in the loaded bill_items. Remaining returnable qty = `bill_item.quantity - sum(exchanges where original_bill_item_id = bill_item.bill_item_id)`.

```javascript
// Fetch exchanges already recorded for this bill's items
const billItemIds = billItems.map(bi => bi.bill_item_id);
const { data: existingExchanges } = await supabase
  .from('exchanges')
  .select('original_bill_item_id, quantity')
  .in('original_bill_item_id', billItemIds);

// Build returnedQtyMap: { bill_item_id: total_returned_qty }
const returnedQtyMap = {};
for (const ex of existingExchanges || []) {
  returnedQtyMap[ex.original_bill_item_id] =
    (returnedQtyMap[ex.original_bill_item_id] || 0) + ex.quantity;
}

// maxReturn per item
const maxReturn = billItems.map(bi => ({
  ...bi,
  maxReturnQty: bi.quantity - (returnedQtyMap[bi.bill_item_id] || 0),
})).filter(bi => bi.maxReturnQty > 0);
```
[VERIFIED: exchanges table schema read; bill_items schema read]

### Pattern 3: Credit Amount Calculation per Item

Per D-08:
```javascript
// For each returned item with returnQty > 0:
function calcItemCredit(bi, returnQty) {
  const fullQty = bi.quantity;
  const proportion = returnQty / fullQty;
  // item_discount_proportional = discount_total (already proportional per item in bill_items)
  const itemDiscProp = round2(Number(bi.discount_total || 0) * proportion);
  // alteration_charge_proportional
  const alterProp = round2(Number(bi.alteration_charge || 0) * proportion);
  // mrp portion
  const mrpPortion = round2(Number(bi.mrp || 0) * returnQty);
  // credit = mrp * qty - discount_prop + alter_prop (GST included, full item value)
  return round2(mrpPortion - itemDiscProp + alterProp);
}
```
Note: `bill_items.discount_total` stores the full discount for the line item. For partial qty, scale proportionally. [VERIFIED: bill_items.sql and buildBillItemsPayload logic read]

### Pattern 4: Exchange Confirmation Orchestration

Atomic sequence in single handler:

1. **Validate** — returnQty > 0 for at least one item; bill still finalized
2. **Restock inventory items** — `UPDATE productsizecolors SET stock = stock + qty WHERE variantid = X` (same non-atomic read-modify-write pattern as BillTable.restoreStockForBill; inherits same TODO comment about atomicity)
3. **Restock manual items** — `UPDATE manual_items SET stock = stock + qty WHERE manual_item_id = X`
4. **Insert exchanges rows** — one per returned item
5. **Update customers.store_credit** — `UPDATE customers SET store_credit = store_credit + totalCredit WHERE customerid = X` (skip if no customer)
6. **Generate PDF** — via ReturnReceiptView ref + generateInvoicePdf(ref, 'a5')
7. **Navigate to /admin/bills** with route state

### Pattern 5: Passing Exchange Credit to BillingForm via Route State

ExchangePage navigates after confirmation:
```javascript
navigate('/admin/bills', {
  state: {
    openNewBill: true,
    exchangeCredit: { amount: totalCredit, label: `Return Credit — Bill #${billNumber}` },
    prefilledCustomerId: bill.customerid || null,
  }
});
```

BillingPage reads on mount:
```javascript
import { useLocation } from 'react-router-dom';

const location = useLocation();
useEffect(() => {
  if (location.state?.openNewBill) {
    setExchangeCredit(location.state.exchangeCredit || null);
    setPrefilledCustomerId(location.state.prefilledCustomerId || null);
    setActiveBillId(null);
    setDialogOpen(true);
    // Clear state so back-nav doesn't re-open
    window.history.replaceState({}, '');
  }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

BillingForm receives `exchangeCredit` as prop, stores in local state. [VERIFIED: BillingPage and App.js routing read]

### Pattern 6: exchangeCredit Deduction in BillingForm + Summary

BillingForm already passes `appliedStoreCredit` as a post-grandTotal deduction (applied after GST, directly reduces net payable). Exchange credit follows the same pattern per D-16.

In `Summary.js`, add a row parallel to the store credit row:
```javascript
const exchangeCreditApplied = Math.min(Number(exchangeCredit?.amount || 0), computed.grandTotal);
const netAfterExchange = Math.max(0, computed.grandTotal - storeCreditApplied - exchangeCreditApplied);
```

In `BillingForm.js`, pass `exchangeCredit` down to Summary and include in finalize payload as a deduction label in notes or as `balance_discount` (or simply document it in bill notes — no DB column needed since it's already baked into `store_credit` on the customer).

**Important:** Exchange credit does NOT reduce `computeBillTotals()` taxable amount (unlike vouchers which are pre-tax). It is a post-GST deduction like store credit. This matches `appliedStoreCredit` behavior in current Summary. [VERIFIED: Summary.js and billUtils.js read]

### Pattern 7: ReturnReceiptView Extension

Add `mode` prop (`'cancel'` | `'exchange'`). Exchange mode changes:
- Header label: "EXCHANGE RECEIPT" vs "STORE CREDIT RECEIPT"
- Note text: `"Store credit of ₹X has been added to your account."` (D-12)
- Items table adds "Credit" column showing per-item credit value (not just MRP)
- Pass `returnDate` as `issueDate`

Existing props (`billId`, `originalBillDate`, `customerName`, `items`, `creditAmount`, `issueDate`) remain; add `mode` and pass `returnItems` array with per-item credit. [VERIFIED: ReturnReceiptView.js read]

### Anti-Patterns to Avoid

- **Saving exchange receipt PDF to Supabase Storage** — out of scope per deferred list; open in new tab only
- **Creating a vouchers table row** — D-09 explicitly says no voucher row; credit goes to `customers.store_credit`
- **Blocking new bill creation on PDF** — PDF is generated but exchange is complete regardless (D-10, D-18)
- **Allowing exchange of draft/cancelled bills** — query must filter `paymentstatus = 'finalized'` (D-02)
- **Over-returning** — UI must cap qty inputs at `maxReturnQty` per item; already-exchanged qty reduces the cap

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF generation | Custom canvas/print logic | `generateInvoicePdf(ref, 'a5')` already in project | Handles multi-page, scaling, format |
| Stock restore | Custom stock calculation | Same pattern as `BillTable.restoreStockForBill` | Proven pattern; same atomicity caveat applies |
| Store credit update | Custom customer update | `UPDATE customers SET store_credit = store_credit + X` direct Supabase call | Same pattern as phase 4 cancel flow |
| Toast notifications | Custom UI | `toast()` from sonner | Already wired app-wide |
| Route state passing | Redux/context for cross-page data | `useNavigate` with `state` + `useLocation` | React Router built-in, no extra deps |

---

## Runtime State Inventory

> Phase adds a new `stock` column to `manual_items`. Not a rename/refactor — no string replacement needed.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `manual_items` rows have no `stock` column yet | migration_14 adds column with `default 1`; existing rows get stock=1 automatically |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

---

## Common Pitfalls

### Pitfall 1: Over-return — no remaining qty guard
**What goes wrong:** Staff returns the same item twice if exchange records aren't checked before rendering qty inputs.
**Why it happens:** ExchangePage loads bill_items but doesn't cross-check existing exchanges for that bill.
**How to avoid:** Always query `exchanges` for all bill_item_ids of the loaded bill before rendering item selection. Compute `maxReturnQty = bi.quantity - alreadyReturned`. Hide or disable items where maxReturnQty = 0.
**Warning signs:** `exchanges` rows accumulate with quantities summing past the original bill_item quantity.

### Pitfall 2: Partial-qty credit calculation uses wrong base
**What goes wrong:** Applying full `bill_items.discount_total` to a partial return instead of scaling by `returnQty/totalQty`.
**Why it happens:** `discount_total` on bill_items is for the full line qty.
**How to avoid:** Always multiply `discount_total * (returnQty / bi.quantity)` for partial returns.
**Warning signs:** Credit amount exceeds MRP × returnQty.

### Pitfall 3: exchangeCredit treated as pre-tax deduction
**What goes wrong:** Passing `exchangeCredit.amount` into `computeBillTotals` as `extraPreTaxDiscount` reduces the taxable base and GST, making the new bill show incorrect GST.
**Why it happens:** `computeBillTotals` has an `extraPreTaxDiscount` param used by balance discount — might seem like the right slot.
**How to avoid:** Exchange credit is post-GST like `appliedStoreCredit` — apply it AFTER `computeBillTotals`, reduce net payable only, never reduce `taxableTotal`.
**Warning signs:** GST on new bill changes when exchange credit is applied.

### Pitfall 4: Route state persists across back-navigation
**What goes wrong:** User navigates back to /admin/bills and BillingForm auto-opens again with stale exchange credit.
**Why it happens:** `location.state` persists in history entry until replaced.
**How to avoid:** After reading route state in BillingPage `useEffect`, call `window.history.replaceState({}, '')` to clear the state.
**Warning signs:** BillingForm opens automatically without user action on page revisit.

### Pitfall 5: No-customer bill — store credit update crashes
**What goes wrong:** Code tries to `UPDATE customers SET store_credit = ...` when `bill.customerid` is null.
**Why it happens:** Bills without a customer have `customerid = null`.
**How to avoid:** Wrap the store credit update in `if (bill.customerid)` guard. PDF still prints; exchange records still insert. Store credit step is simply skipped.
**Warning signs:** Supabase update with `WHERE customerid = null` silently updates 0 rows — no crash, but easy to misread as success when customerid is undefined vs null.

### Pitfall 6: manual_items stock column absent if migration not run
**What goes wrong:** `UPDATE manual_items SET stock = stock + qty` fails with column-not-found error.
**Why it happens:** Migration may not have been run in Supabase dashboard yet.
**How to avoid:** Wave 0 task must include running migration_14. Code should handle gracefully if column absent (log warning, skip manual item restock) or simply document the migration dependency.
**Warning signs:** Supabase update error: `column "stock" of relation "manual_items" does not exist`.

---

## Code Examples

### Bill Search Query (by bill_number)
```javascript
// Source: [VERIFIED: Supabase JS client pattern used throughout this codebase]
const { data: bills } = await supabase
  .from('bills')
  .select('billid, bill_number, orderdate, customerid, customers(first_name, last_name), totalamount')
  .eq('paymentstatus', 'finalized')
  .ilike('bill_number', `%${searchQuery.trim()}%`)
  .order('bill_number', { ascending: false })
  .limit(20);
```

### Exchange Records Insert
```javascript
// Source: [VERIFIED: exchanges table schema read]
const exchangeRows = returnedItems.map(ri => ({
  original_bill_item_id: ri.bill_item_id,
  quantity: ri.returnQty,
  reason: ri.reason || null,
  customerid: bill.customerid || null,
  credit_amount: ri.creditAmount,
  voucher_id: null,
}));
const { error } = await supabase.from('exchanges').insert(exchangeRows);
```

### Store Credit Update
```javascript
// Source: [VERIFIED: refundStoreCreditForBill pattern in BillTable.js]
await supabase
  .from('customers')
  .update({ store_credit: supabase.rpc ? undefined : newBalance })
  // Use atomic increment to avoid read-modify-write race
  // Safe direct pattern (mirrors existing codebase):
  .eq('customerid', bill.customerid);

// Safer pattern (read then write, matches existing BillTable pattern):
const { data: cust } = await supabase
  .from('customers').select('store_credit').eq('customerid', bill.customerid).single();
const newCredit = Number(cust.store_credit || 0) + totalCreditAmount;
await supabase.from('customers').update({ store_credit: newCredit }).eq('customerid', bill.customerid);
```

### ReturnReceiptView Exchange Mode Usage
```javascript
// Source: [VERIFIED: ReturnReceiptView.js and generateInvoicePdf.js read]
const receiptRef = useRef(null);
// After flushSync to render:
const blob = await generateInvoicePdf(receiptRef.current, 'a5');
const url = URL.createObjectURL(blob);
window.open(url, '_blank');

// Component (hidden off-screen):
<ReturnReceiptView
  ref={receiptRef}
  mode="exchange"
  billId={bill.bill_number}
  originalBillDate={bill.orderdate}
  customerName={customerName}
  items={returnedItems}   // array with per-item credit_amount
  creditAmount={totalCredit}
  issueDate={new Date()}
/>
```

### Migration 14
```sql
-- schema/migration_14_manual_items_stock.sql
ALTER TABLE manual_items
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 1;
```
[VERIFIED: manual_items.sql read — column absent, DEFAULT 1 appropriate per D-19]

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| ReturnReceiptView hardcoded for cancellation | Extend with `mode` prop | No rewrite needed; prop branching only |
| BillingForm opened only from BillingPage state | Open from ExchangePage via route state | React Router `useNavigate` state — no Redux needed |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase `!inner` join filter on related table columns (customers) works via PostgREST | Architecture Patterns — Pattern 1 | Two-step query fallback is safe alternative; low risk |
| A2 | `window.history.replaceState({}, '')` clears React Router location.state | Architecture Patterns — Pattern 5 | If it doesn't clear state, use a `sessionStorage` flag instead; low risk |

---

## Open Questions

1. **Should partially-returned items show "partially returned" status in BillTable?**
   - What we know: BillTable shows bill-level status; no item-level status display
   - What's unclear: Whether staff need visual confirmation that some items on a finalized bill have already been returned
   - Recommendation: Out of scope for this phase; defer to exchange history view milestone

2. **Atomicity of multi-step exchange confirmation**
   - What we know: Existing restock is non-atomic (same TODO in BillTable: CR-02). Exchange adds 3-5 Supabase calls.
   - What's unclear: Whether a partial failure (e.g., exchanges insert succeeds but store_credit update fails) needs rollback
   - Recommendation: Wrap all steps in try/catch. On failure, show toast with specific step that failed. Manual remediation acceptable for now — same as existing cancel flow. Note in code with same CR-02 comment pattern.

---

## Environment Availability

Step 2.6: SKIPPED — phase is UI/code changes only. All external dependencies (Supabase, html2canvas, jsPDF, React Router) are already installed and in use in the project.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Create React App default (Jest + React Testing Library) |
| Config file | none detected in root (CRA built-in) |
| Quick run command | `npm test -- --watchAll=false --passWithNoTests` |
| Full suite command | `npm test -- --watchAll=false` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EX-01 | calcItemCredit returns correct credit for partial qty | unit | `npm test -- --watchAll=false --testPathPattern=calcItemCredit` | ❌ Wave 0 |
| EX-02 | maxReturnQty correctly accounts for prior exchanges | unit | `npm test -- --watchAll=false --testPathPattern=exchangeHelpers` | ❌ Wave 0 |
| EX-03 | BillingForm renders exchange credit deduction row | unit/smoke | manual — Dialog requires integration setup | manual-only |
| EX-04 | ReturnReceiptView renders exchange mode with credit column | unit | `npm test -- --watchAll=false --testPathPattern=ReturnReceiptView` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --watchAll=false --passWithNoTests`
- **Per wave merge:** `npm test -- --watchAll=false`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/admin/components/billing/__tests__/exchangeHelpers.test.js` — covers EX-01, EX-02 (pure functions, no Supabase mock needed)
- [ ] `src/admin/components/billing/__tests__/ReturnReceiptView.test.js` — covers EX-04

*(Existing CRA test infrastructure is present; no framework install needed)*

---

## Sources

### Primary (HIGH confidence)
- `schema/exchanges.sql` — exchanges table structure confirmed
- `schema/manual_items.sql` — confirmed no `stock` column; migration_14 needed
- `schema/customers.sql` — confirmed `store_credit double precision` column exists
- `schema/bills.sql` — confirmed `paymentstatus` column; `bill_number` unique
- `schema/bill_items.sql` — confirmed `discount_total`, `alteration_charge`, `variantid` columns
- `src/admin/components/billing/ReturnReceiptView.js` — existing props confirmed
- `src/admin/components/billing/generateInvoicePdf.js` — confirmed `format` param, blob output
- `src/admin/components/billing/billUtils.js` — confirmed `computeBillTotals` signature, `appliedStoreCredit` pattern
- `src/admin/components/billing/Summary.js` — confirmed deduction row pattern
- `src/admin/components/billing/BillingForm.js` — confirmed `appliedStoreCredit` state shape
- `src/admin/components/BillTable.js` — confirmed `restoreStockForBill` and `refundStoreCreditForBill` patterns
- `src/admin/pages/BillingPage.js` — confirmed dialog state management
- `src/App.js` — confirmed `/admin/exchanges` and `/admin/bills` routes exist

### Secondary (MEDIUM confidence)
- React Router `useNavigate` with `state` + `useLocation` for cross-page data — standard documented pattern

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project and confirmed
- Architecture: HIGH — all patterns verified from existing code; two ASSUMED items are low-risk with documented fallbacks
- Pitfalls: HIGH — derived directly from reading existing code and schema
- Credit formula: HIGH — verified against bill_items columns and billUtils logic

**Research date:** 2026-04-21
**Valid until:** 2026-05-21 (stable domain — no fast-moving dependencies)
