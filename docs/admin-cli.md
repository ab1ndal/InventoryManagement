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
  (`UsageError`, `CustomerInputError`, `ManualItemInputError`, `ProductInputError`, `BillInputError`), `1` for anything else (database,
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

Look up a customer by phone, or by name. Read-only.

```bash
node scripts/admin-cli.mjs customer find --phone 9000000001
node scripts/admin-cli.mjs customer find --name "test customer"
```

`--phone`: the full `customers` row, or `null` if no customer has that phone.
`--name`: up to 20 rows where every word appears in the first or last name
(case-insensitive; punctuation ignored), `[]` if none. Use it to check a slip
without a phone before creating a new (guest) customer.

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

Errors: `Give exactly one of --phone or --name`; `Name is required`; `Invalid phone "123": expected 10 digits or
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

## product search

Find inventory products when a slip has no usable code. Read-only. At least
one of `--name`, `--category`, `--cost`, `--mrp` is required; all filters
combine.

```bash
node scripts/admin-cli.mjs product search --category SA --cost ZAAGB --mrp 2395 --in-stock
```

| Option | Notes |
|---|---|
| `--name` | substring of the product name (e.g. `saree`, `georgette`) |
| `--category` | exact category id (`category list`) |
| `--cost` | purchase price as on the slip's price code (`ZAAGB` = 1172) or a number |
| `--mrp` | exact retail price |
| `--color` | substring of a variant colour; keeps only matching variants |
| `--in-stock` | keeps only variants with stock > 0 |

Output: up to 25 products in the same shape as `product find`. With
`--color` / `--in-stock`, products left with no matching variant are dropped.
A cost code alone is rarely unique (three sarees share `ZAAGB` at ₹2395), so
combine it with category, MRP and colour.

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

## Bills

`bill create` makes a **finalized, fully paid Bill of Supply**, writing what
the billing screen's Finalize button writes for a new bill. `bill preview`
shows all of it without writing. Not supported: drafts, discount codes,
vouchers, store credit, exchanges, partial payment, salespersons, PDF, SMS.

### Bill spec

Both commands take the bill as JSON, from a file (`--spec bill.json`) or
inline (`--json '{...}'`):

```json
{
  "customerid": 453,
  "date": "2026-10-22",
  "payment": { "method": "Cash", "amount": 1800 },
  "items": [
    { "variantid": "29c3daa8-5483-4c84-8959-1c930b8d1bb4", "qty": 1, "amount": 1800 },
    { "manual_item_id": "BCX26129", "qty": 1, "alteration_charge": 150 }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `customerid` | yes | from `customer find` / `customer create` |
| `date` | yes | `YYYY-MM-DD`, stored as the bill date; the FY of the bill number follows it |
| `payment.method` | yes | a sales method name (Cash, UPI, Card, Paytm, GPay, Mixed); not Website |
| `payment.amount` | yes | what the customer paid |
| `location` | no | sales location name, default `Walk-In` |
| `notes` | no | |
| `skip_stock` | no | `true` = don't touch stock (the screen's "backdated" checkbox); default reduces stock |
| `items[]` | yes | one or more lines |
| `items[].variantid` / `items[].manual_item_id` | one of | from `product find` / `manual-item find` |
| `items[].qty` | yes | > 0; decimals for meter items |
| `items[].amount` | no | what the line sold for (goods only, excluding alteration); default MRP × qty |
| `items[].alteration_charge` | no | added on top of `amount` |
| `items[].stitch_type` | no | `unstitched` (default) or `stitched` |
| `items[].unit_type` | no | `piece` / `meter`; default the product's unit, or meter for a `FAB-` manual item |

How amounts become a bill, as on the screen:

- MRP is the product's `retailprice` (or the manual item's `mrp`); the line's
  discount is stored as a 2-decimal percentage of MRP × qty, rounded **down**,
  so a line lands on or a few paise above `amount`.
- If the total is above the amount paid by up to ₹100, a balance discount
  trims the bill to exactly the amount paid (the screen's rule,
  `computeBalanceAdjustedTotals`). So set `payment.amount` to the slip's net
  amount and the bill total will equal it.
- Refused, as on the screen: a line discount over 50%, `amount` above MRP,
  payment off from the total by more than ₹100 (partial payment), not enough
  stock (unless `skip_stock`), unknown customer, variant, manual item, method
  or location.
- Warned (non-blocking): a line discount over 30% (the screen asks to
  confirm), paying more than the total (recorded as is).
- No `bill_payments` row: like the screen, a fully paid bill records payment
  as `payment_amount` + `salesmethodid` on the bill.
- Inventory lines get `cost_price: null` and manual lines the item's cost, as
  on the screen. Manual-item stock is not changed (the app never does).

### bill preview

```bash
node scripts/admin-cli.mjs bill preview --spec bill.json
```

Read-only. Output: `customer`, `payment_method`, `location`, the exact `bill`
row and `bill_items` rows that would be inserted (bill number and ids are
assigned on create), `stock` (per variant: `stock_before`, `change`,
`stock_after`), `totals` (`mrp_total`, `line_discounts`, `balance_discount`,
`grand_total`, `paid`) and `warnings`.

### bill create

```bash
node scripts/admin-cli.mjs bill create --spec bill.json --dry-run   # same as preview
node scripts/admin-cli.mjs bill create --spec bill.json
```

Writes, in the screen's order: the bill (the database assigns the next
`FY26-000NNN`), its items (if this fails the bill row is deleted again),
`stock_adjust` per inventory variant (reason `bill_finalize`), and an
activity-log entry `Finalized bill #… for … — ₹…, N items (via CLI)`.

```json
{
  "billid": 353,
  "bill_number": "FY26-000336",
  "customer": { "customerid": 453, "first_name": "Test", "last_name": "Customer", "phone": "+919000000001" },
  "totals": { "mrp_total": 2395, "line_discounts": 594.92, "balance_discount": 0.08, "grand_total": 1800, "paid": 1800 },
  "stock": [ { "variantid": "29c3…", "productid": "BC252051", "size": "FREE-SIZE", "color": "Mustard", "stock_before": 1, "change": -1, "stock_after": 0 } ],
  "stock_failures": [],
  "warnings": []
}
```

A failed stock update does not undo the bill (as on the screen); it is listed
in `stock_failures` with the error. Fix stock by hand for those.

### bill find

Find existing bills, e.g. to check a slip isn't already entered. Read-only.
At least one filter; all combine.

```bash
node scripts/admin-cli.mjs bill find --phone 9000000001 --from 2026-10-01 --to 2026-10-31
node scripts/admin-cli.mjs bill find --product BC-252051
```

| Option | Notes |
|---|---|
| `--customer` | customer id |
| `--phone` | customer phone (unknown phone → `[]`) |
| `--from`, `--to` | bill date range, `YYYY-MM-DD`, inclusive |
| `--product` | a product / manual item code that must appear on the bill |

Output: up to 50 bills, newest first: `billid`, `bill_number`, `orderdate`,
`customerid`, `totalamount`, `payment_amount`, `paymentstatus`, `finalized`,
`document_type`, `customer` (name, phone) and `items` (code, name, qty, MRP,
total). Same customer with similar items near the slip date = likely already
entered; decide before `bill create`.

### bill get

```bash
node scripts/admin-cli.mjs bill get --number FY26-000335
node scripts/admin-cli.mjs bill get --id 352
```

Read-only. The full `bills` row plus `payment_method`, `location`,
`customer`, `items` (each inventory line with its variant's `size`, `color`
and `current_stock`) and `payments` (`bill_payments` rows). `null` if no such
bill.

### Checked against the app

A read-only run over the 75 most recent finalized app bills (rebuilt as
specs, then `bill preview`) matched 57 exactly. The rest differ by paise:
mostly app bills whose total landed below the amount paid (e.g. 999.94 on a
1000 payment) where the CLI lands on the amount paid, plus per-line splits the
rebuild can't recover. One app bill had a 50.57% line discount, which the CLI
refuses.
