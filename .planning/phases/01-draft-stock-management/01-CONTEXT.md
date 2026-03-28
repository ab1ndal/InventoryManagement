# Phase 1: Draft & Stock Management - Context

**Gathered:** 2026-03-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire up BillingForm's `handleSaveDraft` to Supabase: insert `bills` + `bill_items` rows, subtract inventory stock, and enable loading/editing existing draft bills. This phase covers draft persistence only — finalize, payment, PDF, and cancellation are later phases.

</domain>

<decisions>
## Implementation Decisions

### Out-of-Stock Policy
- **D-01:** Block the save if any inventory item's qty exceeds available stock. Show an error listing the specific items and available qty. Staff must fix quantities before saving. Negative stock is not allowed.

### Discount Code Persistence on Draft
- **D-02:** Add an `applied_codes text[]` column to the `bills` table in Phase 1 (schema migration). On draft save, persist the selectedCodes array to this column. On draft load (BILL-03), restore `selectedCodes` from `bills.applied_codes`.

### BillTable Status Display
- **D-03:** Add a Status column to BillTable showing a badge (Draft / Finalized / Cancelled) based on `paymentstatus`. Replace the raw `finalized` boolean display with this badge. Include in the Phase 1 select query.

### Claude's Discretion
- Draft update approach (BILL-02): delete all old bill_items and insert fresh ones — simpler and correct for this phase
- Stock reconciliation implementation: fetch existing bill_items, compute delta per variantid, apply delta in client code
- Error handling for partial DB failures: show destructive toast with error message, do not attempt rollback manually (Supabase handles FK constraints)
- Toast message on draft save: "Draft saved — Bill #[id]" (confirms with bill ID per ROADMAP success criterion)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Implementation Files
- `src/admin/components/billing/BillingForm.js` — Main form with `handleSaveDraft` TODO stub; contains existing state shape (items, selectedCustomerId, notes, selectedCodes, allDiscounts)
- `src/admin/components/billing/billUtils.js` — `computeBillTotals()` provides all total values needed for `bills` row insert
- `src/admin/components/BillTable.js` — Bill list component; needs `paymentstatus` column and Edit button wired to `onEdit`

### Schema Reference
- `schema/initial_schema.sql` — Current `bills` and `bill_items` table definitions; `bills.applied_codes` column does NOT exist yet (must be added via migration)

### Roadmap Implementation Notes
- `.planning/ROADMAP.md` — Phase 1 section has exact field lists for bills/bill_items inserts, stock SQL pattern, and load-for-edit query shape

### Requirements
- `.planning/REQUIREMENTS.md` — BILL-01 through BILL-03, STOCK-01, STOCK-02 acceptance criteria

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeBillTotals(items, selectedCodes, allDiscounts)` in billUtils.js — returns `{itemsSubtotal, itemLevelDiscountTotal, overallDiscount, taxableTotal, gstTotal, grandTotal}` — use directly for bills row totals
- `useToast()` hook — already imported in BillingForm, use for success/error feedback
- `supabase` client — already imported in BillingForm

### Established Patterns
- Direct Supabase calls from component effects/handlers (no API layer)
- `setIsSaving(true)` / `finally { setIsSaving(false) }` pattern already in `handleSaveDraft`
- `refreshFlag` toggle pattern for triggering BillTable re-fetch after mutation
- Destructive toast on error: `{ title: "Error", description: e.message, variant: "destructive" }`

### Integration Points
- BillingForm receives `billId` prop — when non-null, load existing bill on mount (BILL-03)
- BillingForm calls `onSubmit?.()` after save — parent (BillingPage) uses this to trigger BillTable refresh
- BillTable calls `onEdit(billId)` prop — parent must wire this to open BillingForm with the given billId

</code_context>

<specifics>
## Specific Ideas

No specific visual references — this is a data persistence phase, not a UI redesign phase.

</specifics>

<deferred>
## Deferred Ideas

### Phase 4 Enhancement
- **Cancellation flow options:** When cancelling a bill, offer 2 choices: (1) Issue a store credit voucher (default), or (2) Reverse payment in the original payment mode. — This is Phase 4 scope (BILL-05, VOUCH-01). Capture this in Phase 4 context.

</deferred>

---

*Phase: 01-draft-stock-management*
*Context gathered: 2026-03-28*
