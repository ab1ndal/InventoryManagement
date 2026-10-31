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
  (`UsageError`, `CustomerInputError`, `ManualItemInputError`), `1` for anything else (database,
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

## product find

Look up inventory products by code. Read-only. The code is normalised
(`bc-25 2051` → `BC252051`). An exact product id returns just that product;
otherwise up to 10 products whose id contains the code (like the billing
screen's picker). `[]` when nothing matches.

```bash
node scripts/admin-cli.mjs product find --code BC-252051
```

```json
[
  {
    "productid": "BC252051",
    "name": "Georgette-Saree",
    "categoryid": "SA",
    "category_name": "Saree",
    "fabric": "Georgette",
    "purchaseprice": 1172,
    "cost_zcode": "ZAAGB",
    "retailprice": 2395,
    "unit_type": "piece",
    "variants": [
      { "variantid": "29c3daa8-…", "size": "FREE-SIZE", "color": "Mustard", "stock": 1 }
    ]
  }
]
```

`cost_zcode` is the purchase price in the price-tag cipher
(`src/utility/zCode.js`: Z, then A=1 … I=9, Z=0), so it can be matched
against the code written on a slip. Variants are in the app's size order.

## category list

All categories (`categoryid`, `name`), by name. Read-only. Use it to pick
`--category` for `manual-item create`.

## manual-item find

Search manual (non-inventory) items. Read-only. At least one of `--code` /
`--name` is required; filters combine.

```bash
node scripts/admin-cli.mjs manual-item find --name dupatta --in-stock
```

| Option | Notes |
|---|---|
| `--code` | exact id, e.g. `BCX26125` (case-insensitive) |
| `--name` | substring of the name |
| `--in-stock` | only `stock > 0` |

Returns up to 20 rows, newest first, each with `cost_zcode`. Caution: the app
never reduces manual-item stock when one is sold, so `stock: 1` does not prove
the piece is unsold.

## manual-item create

Create a manual item, with the billing screen's manual item form rules.

```bash
node scripts/admin-cli.mjs manual-item create --name Fall --category ACC --mrp 150 --cost ZEZ --dry-run
```

| Option | Required | Notes |
|---|---|---|
| `--name` | yes | |
| `--category` | yes | must exist (`category list`) |
| `--mrp` | yes | number ≥ 0 |
| `--cost` | yes | purchase price as Z-code (`ZEZ` = 50) or a number; must be > 0 |
| `--size`, `--color` | no | |
| `--dry-run` | no | shows the row, including the id it would get |

The id is the next `BCX{YY}{NNN}` for the current year (from
`get_max_manual_item_suffix`), as in the app. Output: the saved row with
`cost_zcode`, or the dry-run preview:

```json
{
  "dry_run": true,
  "would_insert": {
    "manual_item_id": "BCX26129",
    "name": "Fall",
    "categoryid": "ACC",
    "size": null,
    "color": null,
    "purchase_price": 50,
    "mrp": 150
  }
}
```

Errors (exit 2): `Name is required`, `Category is required`,
`Invalid MRP "…"`, `A valid cost is required …`, `Unknown category "…"`.
Like the app, no activity-log entry is written for a new manual item.
