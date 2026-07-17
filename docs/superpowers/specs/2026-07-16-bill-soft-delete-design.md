# Bill Soft-Delete + Cancelled-Revenue Exclusion

**Date:** 2026-07-16
**Status:** Approved, pending implementation

## Problem

Deleting a bill hard-deletes the row (`BillTable.js:670`), which permanently removes the
bill number from the series and leaves an unexplained gap. The FY26 Bill of Supply series
has three such gaps (97, 126, 154) plus a fourth (205) that was closed on 2026-07-16 by
renumbering 206-218 down by one.

A bill number is allocated by the `trg_set_bill_number` `BEFORE INSERT` trigger, so a
**draft** consumes a number the instant it is saved. Bill 97 was a draft that was saved and
then deleted — never finalized, which is why it has no PDF. Any fix that covers only
finalized bills leaves the most common gap source open.

Separately, `paymentstatus = 'cancelled'` already exists as a working tombstone (the row
survives, stock and store credit are reversed, and the table renders a "Cancelled" badge at
`BillTable.js:839-856`). It has never been used — all 216 bills are `finalized`. It has gone
unused in part because **cancelled bills are not excluded from revenue reporting**, so
cancelling a bill today would silently inflate the dashboard.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| State representation | New `deleted_at timestamptz NULL` column | Deletion is orthogonal to payment state. A partial or cancelled bill can also be deleted; overloading `paymentstatus` would destroy the payment state. |
| Distinct from cancelled | Yes — badge reads **Deleted** | A data-entry mistake and a genuine customer refund are different events and must stay distinguishable for audit. |
| Delete button | Stays, becomes soft-delete | Preserves existing muscle memory and the confirm dialog. |
| Scope of drafts | Drafts soft-delete too | Drafts consume numbers; excluding them leaves gaps. |
| Cancelled revenue | Fixed in this change | Same predicate, same lines. Shipping "deleted excluded, cancelled still counted" would knowingly leave revenue wrong. |

## Design

### Schema

New migration `schema/migration_bill_soft_delete.sql`:

```sql
ALTER TABLE public.bills
  ADD COLUMN deleted_at timestamptz NULL,
  ADD COLUMN deleted_by uuid NULL REFERENCES auth.users(id);

CREATE INDEX idx_bills_deleted_at ON public.bills (deleted_at) WHERE deleted_at IS NULL;
```

`deleted_at IS NULL` is the live-bill predicate. The partial index keeps the common
"live bills only" filter cheap.

### Delete handler (`BillTable.js:670`)

Keeps its button and confirm dialog. New body:

1. Guard: if `deleted_at` is already set, no-op. Prevents a double-delete from
   double-restoring stock.
2. `restoreStockForBill(billId)` — unchanged.
3. If finalized and has a customer: `refundStoreCreditForBill`, delete `discount_usage`
   rows — unchanged.
4. `update({ deleted_at: now, deleted_by: uid })` — **replaces** the deletes of
   `bill_items`, `bill_salespersons`, and `bills`.
5. The PDF is left in place. `bill_items` are retained as the record of what was sold.

Side effect: this eliminates the orphaned-PDF leak. The row survives and keeps pointing at
its PDF, so nothing is stranded. The wrong-path bug at `BillTable.js:687-689` (it removes
`bill-{billid}.pdf`, but files are named `bill-{bill_number}...pdf`) becomes moot — that
code is deleted rather than fixed.

### Badge precedence

Deleted wins over Cancelled wins over Finalized/Partial. A deleted bill shows **Deleted**
regardless of its `paymentstatus`.

### Reporting blast radius

Every aggregate over `bills` must exclude deleted bills. Cancelled exclusion is added where
missing.

| File:line | Today | Change |
|---|---|---|
| `BillTable.js:307` | lists all | keep showing deleted; add status filter to hide |
| `CustomerTable.js:61` | `finalized`, `neq cancelled` | + `.is("deleted_at", null)` |
| `DashboardPage.js:44` | **no filter at all** | + `deleted_at IS NULL`, + `neq cancelled` |
| `AdminPage.jsx:59` | **no filter at all** | + `deleted_at IS NULL`, + `neq cancelled` |
| `HistoricalTrends.js:69` | `finalized` only | + `deleted_at IS NULL`, + `neq cancelled` |
| `ExchangePage.js:135,153` | `paymentstatus=finalized` | + `.is("deleted_at", null)` |
| `BillingForm.js:265` | loads any bill | refuse to open a deleted bill for edit |

`DashboardPage.js:44` and `AdminPage.jsx:59` currently apply **no** filter — they count
unfinalized drafts as revenue today. Adding `finalized` is part of the same correctness fix.

`src/admin/components/archive/BillForm.js` also queries `bills` but is dead code and is
deliberately not touched.

### Failure modes

- **Double delete** — guarded by the `deleted_at IS NULL` check in step 1.
- **Partial failure mid-handler** — stock restore runs before the flag is set. If the update
  fails, the bill stays live with restored stock. This matches today's behaviour (the
  existing handler has the same ordering) and is recoverable by retrying. Not made worse
  by this change.
- **Concurrent edit** — a deleted bill can no longer be opened in `BillingForm`, so an
  in-flight edit cannot resurrect it.

## Testing

- `handleDelete` issues `update({deleted_at})` and never calls `.delete()` on `bills`,
  `bill_items`, or `bill_salespersons`.
- Double-delete does not call `restoreStockForBill` twice.
- `BillTable` renders the **Deleted** badge, and it takes precedence over Cancelled.
- A deleted bill is excluded from customer aggregates and dashboard revenue.
- A cancelled bill is excluded from dashboard revenue (regression test for the bug being
  fixed here).
- `BillingForm` refuses to open a deleted bill.

## Out of scope

- **Undelete/restore.** YAGNI until asked.
- **Backfilling tombstones for gaps 97/126/154.** The owner ruled out touching bill IDs.
  These gaps stay; their provenance is documented in this file and in the activity log.
- **Not allocating a number until finalize.** This is the deeper root fix for draft-created
  gaps, but it is a larger change to `BillingForm` and the trigger. Soft-delete makes the
  gap visible-and-explained, which is sufficient.

## Verification

- `npm test` green, including the new tests above.
- Manually: delete a bill in the UI, confirm the row remains with a Deleted badge, its
  number is retained, stock is restored, and dashboard revenue does not move.
