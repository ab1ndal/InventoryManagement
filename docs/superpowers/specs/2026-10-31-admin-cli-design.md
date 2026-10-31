# Admin CLI — Design

Date: 2026-10-31
Status: approved (shape + customer slice), built slice by slice

## Intent

A command-line way to run the admin features, starting with bills and customer
management. First use: the owner (developer) enters new bills — e.g. from paper
slips — through Claude Code by running small, explicit commands instead of
clicking through the billing screen. Each command's input and output is plain
JSON, so a bill entry is auditable as "the slip + the list of commands + their
results", and audits can be run quickly, possibly by an agent.

It is a new way to enter bills, not a backfill: bills get the normal next
`FY26-000NNN` number and behave exactly as app-entered bills do today.

## Goals

- One command, `node scripts/admin-cli.mjs <area> <action> [--options]`.
- JSON output on stdout; errors as JSON on stderr with non-zero exit.
- Every write supports `--dry-run`: prints exactly what would be written,
  writes nothing. This is the approve-then-run step.
- Same business rules as the admin app today. Where the app's behaviour is odd
  (e.g. manual-item stock never decremented), keep it; revisit later.
- Logic lives in shared modules under `src/admin/lib/` that take the Supabase
  client as a parameter, so the app can reuse them later. The CLI is a thin
  wrapper. No second copy of an existing rule.
- A written guide, `docs/admin-cli.md`: per command, purpose, options, sample
  output, errors.

## Non-goals

- No UI. Moving existing screens (e.g. `CustomerForm`, `BillingForm`) onto the
  shared modules is a later, separate step.
- No deployment: the CLI runs locally with the service-role key from `.env`.
- No photo reading / OCR in code — Claude reads slips in the session.

## Decisions

- **Auth:** service-role key from `.env` (developer-only, local). Activity-log
  entries have no actor, so their summary is suffixed "(via CLI)".
- **Form:** JS shared modules + Node CLI, not new DB functions, unless a step
  needs atomicity across tables (then a DB function, as with `stock_adjust`).
- **Pricing:** the CLI reuses `billUtils.js` / `stockHelpers.js` directly
  (no third copy). Line discount ₹→% is rounded down, not to nearest, so the
  balance discount can trim to the exact amount paid.

## Slices (in order)

1. **Customers** — `customer find`, `customer create`. Done.
2. **Lookups** — `product find`, `category list`, `manual-item find/create`. Done.
3. **Bills** — `bill preview`, `bill create`, `bill get`. Done. Header, lines,
   payment, stock and finalize turned out to be one atomic-ish operation in
   the app (direct Finalize), so they are one command over a JSON bill spec
   rather than separate steps; the audit trail is the spec + preview output.
   Pricing reuses `billUtils` (balance-forcing rule extracted from
   BillingForm into `computeBalanceAdjustedTotals`, owner-approved).
4. Next candidates: drafts / editing a bill, partial payment + add payment,
   salespersons, customer edit.

## Slice 1: customers

- `customer find --phone X` → full customer row or `null`. Phone normalised:
  spaces removed; bare 10 digits → `+91` prefix.
- `customer create --first A [--last B] [--phone X] [--email] [--address]
  [--gender] [--notes] [--dry-run]`, same rules as the Add Customer form:
  phone must match `^\+\d{10,15}$`; duplicate phone refused naming the existing
  customer; no phone → `is_guest`; `customer_ulid` generated like the form
  (uuid v4, dashes removed, first 26 chars); `loyalty_tier` bronze,
  `store_credit` 0, marketing opt-in untouched (false); activity-log
  "Added customer …".
- Out: edit, store credit, marketing consent.
- Tests: jest unit tests for normalisation, validation, payload, and the
  find/create flow against a fake client.
