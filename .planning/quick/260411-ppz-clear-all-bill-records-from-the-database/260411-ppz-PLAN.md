---
phase: quick-260411-ppz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - schema/migration_ppz_clear_bills.sql
autonomous: false
requirements: []
must_haves:
  truths:
    - "All rows deleted from bills, bill_items, and bill_salespersons tables"
    - "bills_billid_seq sequence reset so next bill gets billid = 1"
    - "All PDF files deleted from the 'invoices' Supabase Storage bucket"
    - "customers.store_credit values reviewed/zeroed if desired (noted as optional)"
  artifacts:
    - path: "schema/migration_ppz_clear_bills.sql"
      provides: "SQL script to clear all bill data and reset sequence"
  key_links:
    - from: "schema/migration_ppz_clear_bills.sql"
      to: "Supabase SQL Editor"
      via: "Developer pastes and runs the script manually"
---

<objective>
Clear all bill records from the Supabase database and reset bill numbering back to 1. Also delete all PDF invoices stored in the Supabase Storage 'invoices' bucket.

Purpose: Fresh start — wipe test/development billing data before going live.
Output: SQL migration script + manual steps for Storage bucket cleanup.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md

Key schema facts (extracted):
- `bills` table: primary key `billid serial` → sequence name is `bills_billid_seq`
- `bill_items` table: `billid` FK referencing `bills(billid)` — must be deleted first
- `bill_salespersons` table: `billid` FK referencing `bills(billid)` — must be deleted first
- `customers.store_credit` — accumulated from bill cancellations; zeroing is OPTIONAL (see task notes)
- PDFs stored in Supabase Storage bucket: `invoices`, with file paths `bill-{billid}.pdf`
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write SQL migration to clear bills data and reset sequence</name>
  <files>schema/migration_ppz_clear_bills.sql</files>
  <action>
Create `schema/migration_ppz_clear_bills.sql` with the following SQL, in this exact order:

```sql
-- migration_ppz_clear_bills.sql
-- PURPOSE: Wipe all bill records and reset billid sequence to 1.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- WARNING: This is IRREVERSIBLE. All bills, bill_items, and bill_salespersons will be deleted.

BEGIN;

-- 1. Delete junction/child rows first (FK constraints)
DELETE FROM public.bill_salespersons;
DELETE FROM public.bill_items;

-- 2. Delete all bill rows
DELETE FROM public.bills;

-- 3. Reset the serial sequence so the next inserted bill gets billid = 1
ALTER SEQUENCE public.bills_billid_seq RESTART WITH 1;

-- 4. OPTIONAL: Zero out store_credit on all customers.
--    Uncomment the line below ONLY if store credit was issued from test bills
--    and should not carry over to production.
-- UPDATE public.customers SET store_credit = 0;

-- 5. OPTIONAL: Zero out vouchers issued from cancelled test bills.
--    Uncomment if the vouchers table exists and needs clearing too.
-- DELETE FROM public.vouchers;

COMMIT;
```

Do NOT uncomment the optional lines — leave that decision to the developer. Add a comment at the top of the file warning it is irreversible.
  </action>
  <verify>File exists at schema/migration_ppz_clear_bills.sql and contains DELETE FROM public.bill_items, DELETE FROM public.bills, and ALTER SEQUENCE public.bills_billid_seq RESTART WITH 1.</verify>
  <done>SQL script created, readable, contains all three required statements in correct dependency order (child tables before parent), sequence reset present, optional store_credit UPDATE is commented out with explanation.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>SQL migration script at schema/migration_ppz_clear_bills.sql that deletes all bill data and resets the billid sequence.</what-built>
  <how-to-verify>
**Step 1 — Run the SQL script (required):**
1. Open Supabase Dashboard → SQL Editor → New query
2. Paste the full contents of `schema/migration_ppz_clear_bills.sql`
3. Review the optional commented lines (lines 18 and 22) — uncomment if you want store_credit zeroed or vouchers cleared
4. Click Run
5. Confirm: "DELETE X" rows reported for bills, bill_items, bill_salespersons

**Step 2 — Verify sequence reset:**
Run in SQL Editor:
```sql
SELECT last_value FROM public.bills_billid_seq;
-- Should return 1
```

**Step 3 — Clear PDFs from Supabase Storage:**
1. Open Supabase Dashboard → Storage → invoices bucket
2. Select all files (they are named `bill-{N}.pdf`)
3. Delete all selected files
4. Confirm bucket shows 0 objects

**Step 4 — Verify in the app:**
1. Start dev server: `npm start`
2. Navigate to Billing → create a new Draft bill
3. Save it — confirm the new bill gets Bill # 1 (billid = 1)
  </how-to-verify>
  <resume-signal>Type "done" when all steps are complete, or describe any issues encountered.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Developer → Supabase SQL Editor | SQL runs with full DB privileges; no app-layer safeguards |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-ppz-01 | Tampering | bills, bill_items tables | accept | Script is run manually by an authenticated developer in Supabase dashboard; no automated trigger |
| T-ppz-02 | Denial of Service | customers.store_credit | accept | Optional UPDATE is commented out by default; developer must explicitly choose to zero balances |
</threat_model>

<verification>
After the checkpoint confirms success:
- `SELECT COUNT(*) FROM public.bills` returns 0
- `SELECT COUNT(*) FROM public.bill_items` returns 0
- `SELECT last_value FROM public.bills_billid_seq` returns 1
- Supabase Storage `invoices` bucket contains 0 files
- New draft bill saved in the app receives billid = 1
</verification>

<success_criteria>
All bill rows deleted. Bill sequence reset to 1. invoices Storage bucket empty. Next bill created in the app starts at Bill #1.
</success_criteria>

<output>
No SUMMARY.md needed for quick tasks. Confirm completion by typing "done" at the checkpoint.
</output>
