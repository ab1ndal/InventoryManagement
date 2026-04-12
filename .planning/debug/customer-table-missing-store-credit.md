---
status: diagnosed
trigger: "Customer Table missing store_credit column; total_spend/last_purchased_at should be derived from bills not stored"
created: 2026-04-11T00:00:00.000Z
updated: 2026-04-11T00:00:00.000Z
---

## Current Focus

hypothesis: confirmed — two separate issues identified
test: code reading complete
expecting: n/a
next_action: return diagnosis (find_root_cause_only mode)

## Symptoms

expected: Customer Table shows store_credit column; total_spend and last_purchase_date are computed from finalized non-cancelled bills
actual: No store_credit column visible in Customer Table; total_spend and last_purchased_at are mutable stored columns updated on each bill operation
errors: none
reproduction: Visit Customers page; no store_credit column in table; check BillingForm.js and BillTable.js for direct .update() calls to total_spend / last_purchased_at
started: Discovered during UAT Test 16 for phase 04-cancel-voucher-pdf

## Eliminated

- hypothesis: store_credit field doesn't exist in schema
  evidence: schema/initial_schema.sql line 66 confirms `store_credit double precision null default '0'` exists on customers table
  timestamp: 2026-04-11

## Evidence

- timestamp: 2026-04-11
  checked: src/admin/components/CustomerTable.js (full file)
  found: Table header has columns: First Name, Last Name, Phone, Referred By, Email, Loyalty, Total Spend, Last Purchase, Actions. No "Store Credit" column header or <td> cell is rendered. The fetchCustomers query (line 39-41) uses `select("*, referred_by_data:referred_by(first_name, last_name)")` which does fetch store_credit from DB, but the column is never rendered in the JSX.
  implication: store_credit is fetched but never displayed — adding a header <th> and <td> cell is all that is needed

- timestamp: 2026-04-11
  checked: src/admin/components/billing/BillingForm.js lines 650-668
  found: On Finalize, code does a read-then-write: reads `total_spend` from customers table, adds `amountPaidByCustomer`, then writes `{ total_spend: newTotal, last_purchased_at: today }` back to customers row
  implication: total_spend and last_purchased_at are stored as mutable denormalized fields, updated incrementally on each finalize

- timestamp: 2026-04-11
  checked: src/admin/components/BillTable.js lines 167-185 and 336-355
  found: On bill cancel (two code paths), code reads current `total_spend`, subtracts bill's totalamount, queries remaining finalized bills to re-derive last_purchased_at, then writes both back to customers row
  implication: Cancellation attempts to keep total_spend in sync by subtraction — but this is fragile: if the subtracted amount doesn't exactly match what was added (e.g. due to voucher/credit offsets), the balance drifts. It also runs a separate query to re-derive last_purchased_at from bills, showing the system is already half-aware it should be bill-derived.

- timestamp: 2026-04-11
  checked: schema/initial_schema.sql
  found: customers table has `total_spend numeric(12,2)`, `last_purchased_at date`, `store_credit double precision` all as stored nullable columns
  implication: No DB-level computed columns or views — all derivation must happen in application code or via a Supabase RPC/view

## Resolution

root_cause: |
  TWO BUGS:

  1. store_credit column not shown in CustomerTable:
     CustomerTable.js has 9 header columns (First Name, Last Name, Phone, Referred By, Email, Loyalty, Total Spend, Last Purchase, Actions) but never renders a "Store Credit" column. The field IS fetched by the wildcard select(*) query and exists on the customer object, but there is no <th> header or <td> cell for it anywhere in the table JSX.

  2. total_spend / last_purchased_at stored as mutable fields, not derived from bills:
     BillingForm.js (line 650-668) increments total_spend and sets last_purchased_at=today on every Finalize. BillTable.js (lines 167-185 and 336-355) attempts to reverse this by subtracting on cancel. This means the values are denormalized running totals that can drift from truth (e.g., if a bill used store credit, the subtraction on cancel uses totalamount not amountPaidByCustomer; partial failures leave inconsistent state). The correct approach is to derive both values live from the bills table (WHERE status='finalized' AND NOT cancelled) each time the customer table loads.

fix: (not applied — find_root_cause_only mode)
verification: (not applied)
files_changed: []
