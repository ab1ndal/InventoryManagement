---
phase: 260428-tgs
plan: "01"
subsystem: suppliers
tags: [suppliers, transactions, ledger, storage, crud]
dependency_graph:
  requires: []
  provides: [supplier-crud, supplier-transactions, supplier-ledger, supplier-bill-images]
  affects: [SuppliersPage]
tech_stack:
  added: []
  patterns: [react-hook-form+zod, refreshSignal, supabase-storage]
key_files:
  created:
    - schema/migration_supplier_transactions.sql
    - schema/migration_supplier_bills.sql
    - src/admin/components/SupplierForm.js
    - src/admin/components/SupplierTable.js
    - src/admin/components/SupplierTransactionDialog.js
    - src/admin/components/SupplierLedgerDialog.js
  modified:
    - src/admin/pages/SuppliersPage.js
decisions:
  - Used existing suppliers table fields only (name, phone, email, notes) — no new columns
  - Balance computed client-side from supplier_transactions rows (sum bills - sum payments)
  - Bill image upload conditional on type=bill, optional
  - ScrollArea wraps ledger table only when rows > 20
metrics:
  duration: ~25min
  completed: "2026-04-28"
  tasks_completed: 6
  tasks_total: 7
  files_created: 6
  files_modified: 1
---

# Phase 260428-tgs Plan 01: Supplier Page with Contact Form and Transactions Summary

One-liner: Full supplier management UI — CRUD contact form, transaction recording (bill/payment), running balance ledger, and optional bill image uploads to Supabase Storage.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Schema migrations | d853a1a | schema/migration_supplier_transactions.sql, schema/migration_supplier_bills.sql |
| 2 | SupplierForm dialog | f81dc16 | src/admin/components/SupplierForm.js |
| 3 | SupplierTable | 0621b85 | src/admin/components/SupplierTable.js |
| 4 | SupplierTransactionDialog | 4072c61 | src/admin/components/SupplierTransactionDialog.js |
| 5 | SupplierLedgerDialog | a6c6df5 | src/admin/components/SupplierLedgerDialog.js |
| 6 | SuppliersPage composition | 548f90e | src/admin/pages/SuppliersPage.js |
| 7 | Manual verification (checkpoint) | — | Awaiting human |

## Checkpoint Pending

Task 7 is a `checkpoint:human-verify` gate. Migrations must be run in Supabase dashboard and smoke test performed before this plan is fully complete.

### Manual Steps Required

1. Run in Supabase SQL editor:
   - `schema/migration_supplier_transactions.sql`
   - `schema/migration_supplier_bills.sql`
2. Create Supabase Storage bucket named `supplier-bills` (public: true). Add policies: authenticated INSERT + SELECT.
3. `npm start` → navigate to `/admin/suppliers`
4. Add supplier, edit supplier, record bill with image, record payment, view ledger — confirm all 9 smoke-test steps in Task 7 pass.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all data wired to live Supabase queries.

## Threat Flags

None — no new network endpoints or auth paths introduced. All access gated by existing `RequireAdminAuth` wrapper on `/admin/*`.

## Self-Check

- [x] schema/migration_supplier_transactions.sql — FOUND (d853a1a)
- [x] schema/migration_supplier_bills.sql — FOUND (d853a1a)
- [x] src/admin/components/SupplierForm.js — FOUND (f81dc16)
- [x] src/admin/components/SupplierTable.js — FOUND (0621b85)
- [x] src/admin/components/SupplierTransactionDialog.js — FOUND (4072c61)
- [x] src/admin/components/SupplierLedgerDialog.js — FOUND (a6c6df5)
- [x] src/admin/pages/SuppliersPage.js — FOUND (548f90e)
- [x] npm run build — PASSED (clean, no errors)

## Self-Check: PASSED
