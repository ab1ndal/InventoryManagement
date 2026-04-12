# Phase 5: Support Different Discount Types in Billing — Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Audit, fix, and validate the end-to-end discount workflow in the billing system. All five discount types must be creatable via the admin UI, applied correctly in BillingForm, and displayed accurately in printed invoices.

This phase does NOT add new discount types or a new discount data model — it makes the existing system work correctly. Item-level flat-amount discounts are explicitly out of scope (percentage-only per item is sufficient).

</domain>

<decisions>
## Implementation Decisions

### Phase Scope
- **D-01:** End-to-end audit and fix — not new capabilities. Every discount type (flat, percentage, buy_x_get_y, fixed_price, conditional) must be verifiable: create in DiscountForm → appear in BillingForm → apply correctly → show in invoice PDF.

### Auto-Apply Bug Fix
- **D-02:** `auto_apply` discounts must still respect their conditions before being pre-selected in BillingForm. A discount marked `auto_apply` should only activate if:
  - `start_date` is null or ≤ today
  - `end_date` is null or ≥ today
  - `min_total` (if set) is met by the current bill total
  - Other type-specific conditions (e.g., category items present for buy_x_get_y)
- **D-03:** Currently auto_apply discounts blindly pre-select regardless of conditions — this is the root cause of "irrelevant discounts being applied."

### Date Filtering
- **D-04:** BillingForm must filter out expired discounts (where `end_date` is not null and `end_date < today`) before displaying in DiscountSelector. Expired discounts must not appear — not even as disabled options.

### Once-Per-Customer Enforcement
- **D-05:** When a customer is selected in BillingForm, query `discount_usage` for that `customerid` to find all previously-used codes. Filter `once_per_customer = true` discounts that already appear in that customer's `discount_usage` records — hide them from DiscountSelector entirely.
- **D-06:** If no customer is selected, all discounts show (no filtering possible without a customer).

### DiscountForm Completeness
- **D-07:** Audit DiscountForm for each type and fix any missing or unclear fields:
  - `buy_x_get_y`: must have a category picker (optional — restricts free items to a specific category)
  - `conditional`: `min_total` and `value` fields must be clearly labeled and functional
  - `fixed_price`: `rules_fixed_total` and optional category must be clear
  - All types: `start_date`, `end_date`, `min_total`, `max_discount`, `exclusive`, `auto_apply`, `once_per_customer` toggles must be visible and wired
- **D-08:** The `conditional` type's `value` field is the flat amount off (not a percentage). The form must make this unambiguous.

### Buy-X-Get-Y Validation
- **D-09:** Buy-X-Get-Y has never been tested end-to-end. As part of this phase: create a test buy_x_get_y discount, apply it to a bill with qualifying items, and verify `valueOfDiscount()` returns the correct amount (cheapest eligible items = free items, sorted ascending).

### Buy-X-Get-Y Invoice Display
- **D-10:** The printed invoice PDF must show which items are free when buy_x_get_y is applied. Implementation: in `InvoiceView.js`, after computing the buy_x_get_y discount value, identify the specific line items that are "free" (cheapest eligible items up to `get_qty × group_count`) and label them with "FREE" in the invoice line items table.
- **D-11:** The label appears in the invoice PDF only (not in the billing Summary panel — that already shows "Code Discounts: -₹X" which is sufficient for pre-invoice review).

### Item-Level Discounts
- **D-12:** No change — `quickDiscountPct` (percentage per item) remains the only item-level discount. Flat ₹X item discounts are not needed.

### Claude's Discretion
- How "FREE" is visually styled in InvoiceView (badge, strikethrough, small text label — any clear approach)
- Order of discount eligibility checks in the auto-apply fix
- Whether to show a tooltip/badge on filtered-out once_per_customer codes or silently hide them

</decisions>

<specifics>
## Specific Details

- The `once_per_customer` query: `SELECT code FROM discount_usage WHERE customerid = X` — filter discounts where `once_per_customer = true AND code IN (already-used codes)`
- Auto-apply condition check must happen AFTER items are loaded (so `min_total` and category checks have item data to work with)
- `billUtils.js` buy_x_get_y: eligible items are filtered by `rules.category` (if set), sorted ascending by unit `withCharges`, and the cheapest `get_qty × group_count` items are free
- InvoiceView free-item identification: re-run the same cheapest-item logic from `valueOfDiscount` during invoice rendering to know which line items to mark "FREE"
- DiscountForm `conditional` type: `min_total` is stored at top-level on the `discounts` row; `value` is the flat discount amount (₹X off). These map to `d.min_total` and `d.value` in `billUtils.js valueOfDiscount`.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Discount Logic
- `src/admin/components/billing/billUtils.js` — `valueOfDiscount()` (lines ~80–130): all five type implementations; `applyOverallDiscounts()`: how codes are combined (exclusive logic); `computeBillTotals()`: where overallDiscount feeds into grandTotal
- `src/admin/components/billing/DiscountSelector.js` — Checkbox UI for discount selection in BillingForm; `isAuto` rendering; how auto_apply discounts are visually distinguished

### BillingForm Integration
- `src/admin/components/billing/BillingForm.js` — Lines ~94–101: discount fetch from Supabase; Line ~258–259: `computeBillTotals` call with `selectedCodes`; Lines ~656–663: `discount_usage` insert on finalize; `selectedCodes` state management
- `src/admin/components/billing/Summary.js` — "Code Discounts" deduction row display

### Invoice Display
- `src/admin/components/billing/InvoiceView.js` — Line ~25: item-level quickDiscountPct rendering; Line ~147: "Overall Discount" line showing applied codes and amount
- `src/admin/components/billing/generateInvoicePdf.js` — PDF generation pattern (html2canvas + jsPDF)

### Discount Management UI
- `src/admin/components/DiscountForm.js` — All type form fields; Zod schema; how `rules` JSONB is assembled on save; known TODO comment at line ~52 for fixed_price rules
- `src/admin/components/DiscountTable.js` — How discounts are listed and edited
- `src/admin/pages/DiscountPage.js` — Entry point for discount management

### Schema
- `schema/initial_schema.sql` — `discounts` table (code, type, value, max_discount, category, once_per_customer, exclusive, auto_apply, min_total, start_date, end_date, active, rules JSONB); `discount_usage` table (customerid, code, billid)

### Requirements & Planning
- `.planning/REQUIREMENTS.md` — No specific REQ-IDs for Phase 5 (TBD); discount types referenced implicitly in BILL-04 (finalize records discount_usage)
- `.planning/ROADMAP.md` — Phase 5 description and success criteria (TBD)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `valueOfDiscount(d, items)` in `billUtils.js` — The buy_x_get_y cheapest-item logic must be replicated/shared in InvoiceView for the "FREE" label feature. Consider extracting a `getFreeItems(d, items)` helper from this function.
- `discount_usage` insert pattern in `BillingForm.js` (line ~656) — The `once_per_customer` query follows the same Supabase pattern; query on customer select, not on every render.
- `discountLabel()` in `DiscountSelector.js` — Already handles all type labels for display; extend if needed for new DiscountForm help text.

### Established Patterns
- Direct Supabase calls from component effects/handlers (no API layer)
- `useEffect` + dependency array for reactive data fetches (trigger re-fetch when `customerId` changes for the once_per_customer check)
- Toast for errors + success (`toast.error`, `toast.success`)
- `useState` + `useEffect` for local eligibility state

### Integration Points
- BillingForm `useEffect` on customer select → add: query `discount_usage WHERE customerid=X` → store used codes → filter `selectedCodes` and `allDiscounts` shown in DiscountSelector
- BillingForm discount fetch → add: filter `end_date` < today before setting `allDiscounts` state
- BillingForm auto-apply logic → add: condition checks on top of `d.auto_apply` flag before pre-selecting
- InvoiceView → add: buy_x_get_y free-item identification + "FREE" label in line items table

</code_context>

<deferred>
## Deferred Ideas

- **Voucher management UI** — Creating/issuing promotional voucher codes from an admin screen (already deferred from Phase 4)
- **Loyalty tier discounts** — Auto-discounts based on customer loyalty tier (future milestone)
- **Flat ₹X item-level discounts** — User confirmed not needed; quickDiscountPct (%) is sufficient
- **Discount analytics** — Which codes are used most, total discount given per period (future milestone)
- **Category-restricted percentage discounts** — "20% off Kurtis only" as a separate type (not currently supported; would require schema + logic changes)

</deferred>

---

*Phase: 05-support-different-discount-types-in-billing-percentage-disco*
*Context gathered: 2026-04-11*
