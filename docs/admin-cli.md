# Admin CLI

Command-line access to admin features, for entering and auditing data without
the admin screens (e.g. entering paper bills through Claude Code). Design:
`docs/superpowers/specs/2026-10-31-admin-cli-design.md`.

```bash
node scripts/admin-cli.mjs <area> <action> [--options]
node scripts/admin-cli.mjs            # lists all commands
```

- **Output:** success → JSON on stdout, exit `0`. Failure → one JSON line on
  stderr, `{"error": "...", "type": "..."}`, exit `2` for bad input
  (`UsageError`, `CustomerInputError`), `1` for anything else (database,
  network).
- **Dry run:** every write accepts `--dry-run`: it runs all checks and prints
  `{"dry_run": true, "would_insert": {...}}` without writing. Use it to review
  a change before running it for real.
- **Access:** uses `SUPABASE_SERVICE_ROLE_KEY` from `.env`, which bypasses RLS.
  Local, developer-only; never ship it or run it on a shared machine.
- **Same rules as the app:** commands call the shared modules in
  `src/admin/lib/`, which follow the admin screens' behaviour.
- **Activity log:** writes add the usual activity-log entry, with no actor and
  the summary ending `(via CLI)`.

## Phone numbers

Spaces are removed, and a bare 10-digit number gets `+91`
(`90000 00001` → `+919000000001`). Anything else must already be
`+<country code><number>`, 10–15 digits. Phone is the customer's identity:
one phone, one customer.

## customer find

Look up a customer by phone. Read-only.

```bash
node scripts/admin-cli.mjs customer find --phone 9000000001
```

Output: the full `customers` row, or `null` if no customer has that phone.

```json
{
  "customerid": 6,
  "phone": "+919000000002",
  "first_name": "Test",
  "last_name": "Customer",
  "is_guest": false,
  "store_credit": 0,
  "...": "every other customers column"
}
```

Errors: `--phone is required`; `Invalid phone "123": expected 10 digits or
+<country code><number>` (exit 2).

## customer create

Create a customer, with the Add Customer form's rules.

```bash
node scripts/admin-cli.mjs customer create --first Test --last Customer --phone 9000000001 --dry-run
node scripts/admin-cli.mjs customer create --first Test --last Customer --phone 9000000001
```

| Option | Required | Notes |
|---|---|---|
| `--first` | yes | first name |
| `--last` | no | |
| `--phone` | no | no phone → guest customer (`is_guest: true`) |
| `--email` | no | must look like an email |
| `--address`, `--gender`, `--notes` | no | free text (`--notes` → `customer_notes`) |
| `--dry-run` | no | check and show, don't write |

Also set: a new `customer_ulid`, `loyalty_tier: "bronze"`, `store_credit: 0`.
Marketing opt-in stays off.

Output: the created `customers` row (or the dry-run preview):

```json
{
  "dry_run": true,
  "would_insert": {
    "customer_ulid": "9dd2dd1adcbe41b0963a5fbdea",
    "first_name": "Test",
    "last_name": "Customer",
    "phone": "+919000000001",
    "email": null,
    "address": null,
    "gender": null,
    "customer_notes": null,
    "loyalty_tier": "bronze",
    "store_credit": 0,
    "referred_by": null,
    "is_guest": false
  }
}
```

Errors (exit 2): `First name is required`; `Invalid email "..."`; invalid
phone; `Phone +919000000002 already belongs to customer 6 (Test Customer)` —
use `customer find` and bill that customer instead.

Not yet supported: editing a customer, store credit, marketing consent.
