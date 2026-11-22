# Admin CLI

Command-line access to admin features, for entering and auditing data without
the admin screens (e.g. entering paper bills through Claude Code). Design:
`docs/superpowers/specs/2026-10-31-admin-cli-design.md`.

```bash
node scripts/admin-cli.mjs login --email you@example.com   # once, in your own terminal
node scripts/admin-cli.mjs <area> <action> [--options]
node scripts/admin-cli.mjs                                   # lists all commands
```

- **Output:** success → JSON on stdout, exit `0`. Failure → one JSON line on
  stderr, `{"error": "...", "type": "..."}`, exit `2` for bad input
  (`UsageError`, `CustomerInputError`, `ManualItemInputError`, `ProductInputError`, `VariantInputError`, `BillInputError`, `SlipPhotoInputError`, `SlipFileError`, `BillPdfError`), `3` for not logged in /
  not an admin (`AuthError`), `1` for anything else (database, network).
- **Dry run:** every write accepts `--dry-run`: it runs all checks and prints
  `{"dry_run": true, "would_insert": {...}}` without writing. Use it to review
  a change before running it for real.
- **Access:** only an active admin can run commands — see
  [Login and security](#login-and-security).
- **Same rules as the app:** commands call the shared modules in
  `src/admin/lib/`, which follow the admin screens' behaviour.
- **Activity log:** writes add the usual activity-log entry, with the
  logged-in admin as actor and the summary ending `(via CLI)`.

## Login and security

The CLI holds no secret key. It uses only the public project URL and anon key
from `.env` and signs in as an admin user, so every command runs under the
same database access rules (RLS) and admin check as the admin app: the
account's `profiles.role` must be `admin` or `superadmin` and not inactive.
With the anon key alone (no login) the tables return nothing and
`stock_adjust` is refused — checked against prod 2026-10-31.

```bash
node scripts/admin-cli.mjs login --email you@example.com   # prompts for the password, hidden
node scripts/admin-cli.mjs whoami                           # { email, user_id, role }
node scripts/admin-cli.mjs logout                           # revokes the session, deletes the file
```

- `login` must be run in an interactive terminal (your own, not through
  Claude): the password is typed at a hidden prompt and is never accepted as
  an argument, from a file or from a pipe, and is not stored.
- It uses email + password. An admin who only signs in with Google first sets
  a password via the admin app's "Forgot password" page.
- The session (access + refresh token, no password) is saved to
  `~/.config/bindals-admin-cli/session.json`, readable only by your OS user
  (the CLI refuses a session file others can read). Override the path with
  `ADMIN_CLI_SESSION`.
- Every command re-checks the admin role, so removing someone's admin role
  stops their CLI on the next command. `logout` revokes the session server-side.
- Not logged in, session expired, or not an admin → exit `3`; log in again.

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

## product near

When the code written on a slip disagrees with the slip's rate or colour, a
digit was probably miswritten or misread. Lists the products one digit off the
written code that match the slip, across all categories. Read-only. When the
category is known, `product search --category … --mrp … --near <code>` comes
first; this is the fallback when that finds nothing.

```bash
node scripts/admin-cli.mjs product near --code BC253248 --mrp 2195 --color fawn --in-stock
```

| Option | Notes |
|---|---|
| `--code` | the code as written (normalised like `product find`) |
| `--mrp` | the slip's rate: keeps near codes at exactly this MRP |
| `--color` | substring of a variant colour; keeps only matching variants |
| `--in-stock` | keeps only variants with stock > 0 |

Every digit of the code is tried with each other digit (`BC253248` → 54
codes). Output:

```json
{
  "written": { "productid": "BC253248", "retailprice": 2995, "variants": [ … ] },
  "written_matches": { "mrp": false, "color": false },
  "near": [
    { "productid": "BC253249", "retailprice": 2195, "changed": "8→9 at digit 8", "lookalike": false, "variants": [ … ] }
  ]
}
```

`written` is the written code's product (`null` if none) and
`written_matches` says whether it fits `--mrp` / `--color` (`null` for a
filter not given). `near` holds up to 25 products in `product find`'s shape
plus `changed` and `lookalike`. Look-alike digits on slips (3/5, 4/9, 1/7,
1/2, 6/8) come first, then products with stock. Without `--color` or
`--in-stock`, every existing near code is listed.

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
| `--near` | the code written on the slip: each product gets `code_distance` (digits to change, add or drop to reach its code) and the closest codes come first |

Output: up to 25 products in the same shape as `product find`. With
`--color` / `--in-stock`, products left with no matching variant are dropped.
A cost code alone is rarely unique (three sarees share `ZAAGB` at ₹2395), so
combine it with category, MRP and colour.

A slip whose code does not match its rate or description: search the slip's
category and MRP (and cost code, if written) with `--near <written code>`.
The miswritten code is usually at the top, one or two digits off. The ranking
covers the first 200 products by code that match the filters, enough for any
category + MRP listing.

```bash
node scripts/admin-cli.mjs product search --category RMS --mrp 2195 --cost ZAAGB --near BC253248
```

## category list

All categories (`categoryid`, `name`), by name. Read-only. Use it to pick
`--category` for `manual-item create`.

## salesperson list

All salespersons (`salesperson_id`, `name`, `active`), by name. Read-only.
Use it to pick names for a bill spec's `salespersons` (the names written at
the top right of a paper slip). Only active ones can go on a bill, as on the
billing screen.

```json
[
  { "salesperson_id": 1, "name": "Asha", "active": true },
  { "salesperson_id": 4, "name": "Bina", "active": false }
]
```

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

Returns up to 20 rows, newest first, each with `cost_zcode`. A sale takes
manual-item stock (`schema/migration_manual_item_stock.sql`), so `stock` 0 means
sold and `--in-stock` lists unsold items. Fabric stock is in metres (e.g. 1.5).

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
| `--cost` | no | purchase price as Z-code (`ZEZ` = 50) or a number; must be > 0. Left out: half the MRP, rounded to the nearest 10 (owner rule for slips with no cost; MRP 1795 → 900) |
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
`Invalid MRP "…"`, `A valid cost is required …` (also when no cost is given and half the MRP rounds to 0), `Unknown category "…"`.
Like the app, no activity-log entry is written for a new manual item.

## stock add

Add stock to a product's size and colour, for a slip whose piece is on the
shelf but not in the inventory. Same writes as the bill screen's "add stock /
new variant": stock on an existing variant moves only by `stock_adjust`
(reason `manual_edit`), and the activity log gets `Increased stock of …` or
`Added variant …`, ending `(via CLI)`.

```bash
node scripts/admin-cli.mjs stock add --code BC25385 --size "XL|42" --color Pink --qty 1 --dry-run
node scripts/admin-cli.mjs stock add --code BC25385 --size "3XL|46" --color Pink --qty 1 --new-variant
```

| Option | Required | Notes |
|---|---|---|
| `--code` | yes | the exact product code (normalised like `product find`) |
| `--size`, `--color` | yes | matched to an existing variant ignoring case; the variant's own spelling is kept |
| `--qty` | yes | > 0; whole pieces, or metres to 3 decimals for metre products |
| `--new-variant` | no | allow a size and colour the product doesn't have yet; both must be in the inventory's size and colour lists (size as the code, e.g. `XL\|42`) |
| `--dry-run` | no | look up and show the change, write nothing |

Without `--new-variant`, a size and colour the product doesn't have is refused
with its variants listed, so a typo or a near shade (Yellow for Mustard) can't
become a new variant. Quote the size: `|` is a shell pipe.

```json
{
  "productid": "BC25385",
  "name": "Cotton Self-Shirt",
  "size": "XL|42",
  "color": "Pink",
  "variantid": "c594874d-…",
  "created": false,
  "stock_before": 0,
  "stock": 1
}
```

`variantid` is `null` in a dry run of a new variant. Errors (exit 2):
`No product …`, `… has no Mustard / XL|42 variant (has: …). Pass --new-variant to add it`,
`Unknown size "46": use a size code like XL|42`, `Unknown colour "…"`,
`Stock to add must be more than 0`, `Stock to add must be a whole number of pieces`.

## Bills

`bill create` makes a **finalized Bill of Supply**, fully paid or part paid,
writing what the billing screen's Finalize (or partial finalize) button writes
for a new bill, or, with `"draft": true`, a **draft bill** as the screen's
Save Draft writes it (see [Draft bills](#draft-bills)), and an exchange
(goods returned from an earlier bill paying for part of the new one, see
[Exchanges](#exchanges)). `bill preview` shows all of it without writing.
Not supported: discount codes, vouchers, store credit, recording a later
payment or finishing a draft (use the Bills screen), per-line salespersons,
SMS. The bill's PDF is a separate step:
[bill pdf](#bill-pdf), or [slip finish](#slip-finish) does create, PDF and a
check in one command.

### Bill spec

One JSON per bill, from a file (`--spec bill.json`) or inline
(`--json '{...}'`). A whole paper slip is one spec, written with readable
references so it can be audited before it runs:

```json
{
  "customer": { "phone": "9000000001", "create_if_missing": { "first": "Test", "last": "Customer" } },
  "date": "2026-10-22",
  "payment": { "method": "Cash", "amount": 1950 },
  "notes": "Paper bill 387",
  "salespersons": ["Asha", "bina"],
  "items": [
    { "product": "BC-252051", "color": "Mustard", "qty": 1, "amount": 1800 },
    { "manual_item": { "create": { "name": "Fall", "category": "ACC", "mrp": 150, "cost": "ZEZ" } }, "qty": 1 }
  ]
}
```

Unknown fields are refused (a typo like `"colour"` fails the preview).

**Customer** — exactly one of:

| Form | Meaning |
|---|---|
| `"customer": { "id": 453 }` (or top-level `"customerid": 453`) | an existing customer |
| `"customer": { "phone": "…" }` | the customer with that phone; refused if none |
| `"customer": { "phone": "…", "create_if_missing": { "first": "…", "last": "…" } }` | that customer, or create them with this name. If the phone already belongs to someone with a different name, the existing customer is billed and a warning is shown |
| `"customer": { "create": { "first": "…" } }` | a new guest customer (no phone) |

Customer fields for `create` / `create_if_missing`: `first` (required),
`last`, `email`, `address`, `gender`, `notes` — same rules as
`customer create`.

**Line** — exactly one item reference:

| Form | Meaning |
|---|---|
| `"product": "BC-252051"` (+ `"color"`, `"size"`) | the product's variant; colour/size (case-insensitive) must narrow it to exactly one, else it is refused with the variants listed |
| `"variantid": "…"` | a variant by id |
| `"manual_item_id": "BCX26125"` or `"manual_item": { "id": "BCX26125" }` | an existing manual item |
| `"manual_item": { "create": { "name", "category", "mrp"[, "cost", "size", "color"] } }` | a new manual item, same rules as `manual-item create` (`cost` as Z-code or number; left out = half the MRP rounded to 10) |

| Field | Required | Notes |
|---|---|---|
| `date` | yes | `YYYY-MM-DD`, stored as the bill date; the FY of the bill number follows it |
| `payment.method` | yes, unless nothing is paid | a sales method name (Cash, UPI, Card, Paytm, GPay, Mixed); not Website. Split payments: one combined amount, method `Mixed`, the split in `notes` |
| `payment.amount` | yes, unless an exchange covers the bill | what the customer paid (the slip's net amount, or the first payment of a part-paid bill). With an [exchange](#exchanges), what was paid on top of the credit |
| `payment.balance_due` | no | what the customer still owes (slip "bal 3950"); > 0 makes a part-paid bill priced at `amount + balance_due`. Nothing paid yet: `"amount": 0` and no `method`; the bill then has no payment method and no `bill_payments` row, as on the screen |
| `location` | no | sales location name, default `Walk-In` |
| `notes` | no | e.g. `"Paper bill 387; Cash 1000 + UPI 950"` |
| `skip_stock` | no | `true` = don't touch stock (the screen's "backdated" checkbox); default reduces stock |
| `draft` | no | `true` = save as a draft bill, for a slip marked "not confirmed yet" ([Draft bills](#draft-bills)); default `false` |
| `exchange` | no | goods returned from an earlier bill whose credit pays for part of this one, or credit recorded earlier: see [Exchanges](#exchanges) |
| `stock_adds` | no | stock to add before the bill, for pieces on the shelf but not in the inventory: a list of `{ "code", "size", "color", "qty"[, "new_variant": true] }`, each exactly a [stock add](#stock-add) (see [Stock adds](#stock-adds)); default none |
| `salespersons` | no | the bill's salespeople (names at the top right of the slip): a list of names (case-insensitive) and/or ids from `salesperson list`, e.g. `["Asha", 4]`. Refused: an unknown name or id, an inactive salesperson (the screen does not offer them), a name two active salespersons share (give the id). Saved as the screen's Salesperson(s) selector saves them: `bill_salespersons` rows, written by `bill_save`. Lines get no salesperson. Default none |
| `items[].qty` | yes | > 0; decimals for meter items |
| `sold_total` | no | one amount for all the lines (goods only, excluding alteration), for a slip with a single total or a bill-level "-20%": split over the lines by MRP share, each rounded to the nearest ₹10, the largest-MRP line taking the remainder so the lines add up exactly (1850 over MRP 1000 + 1335 → 790 + 1060). If that would push the largest line over its MRP, the shares are kept to the paisa. At or above the MRP total, every line stays at MRP. Not with `items[].amount`. `bill preview` shows the result as `sold_split` |
| `items[].amount` | no | what the line sold for (goods only, excluding alteration); default MRP × qty |
| `items[].alteration_charge` | no | added on top of `amount` (e.g. fall/pico charged with the item) |
| `items[].stitch_type` | no | `unstitched` (default) or `stitched` |
| `items[].unit_type` | no | `piece` / `meter`; default the product's unit, or meter for a `FAB-` manual item |

How amounts become a bill, as on the screen:

- MRP is the product's `retailprice` (or the manual item's `mrp`); the line's
  discount is stored as a 2-decimal percentage of MRP × qty, rounded **down**,
  so a line lands on or a few paise above `amount`.
- If the total is above the amount paid by up to ₹100, a balance discount
  trims the bill to exactly the amount paid (the screen's rule,
  `computeBalanceAdjustedTotals`). So set `payment.amount` to the slip's net
  amount and the bill total will equal it. For a part-paid bill the same
  applies to `amount + balance_due`.
- Refused, as on the screen: a line discount over 50%, `amount` above MRP,
  payment (`amount + balance_due`) off from the line total by more than ₹100, not enough
  stock (unless `skip_stock`), unknown customer, variant, manual item, method
  or location.
- A line refused for a missing variant (`… has no variant Pink; …`) or for
  not enough stock ends with the `stock add` command that would let it
  through, for when the piece is on the shelf but not in the inventory:
  `If the pieces are on the shelf, add them: stock add --code BC252051 --size 'XL|42' --color 'Mustard' --qty 2`
  (the shortfall), or the same with `--new-variant` and the line's quantity
  for a missing variant. A size or colour the line leaves out is filled in
  when the product has only one, else left as `'<size>'` / `'<color>'` to
  fill in. Check the slip and shelf before running it, or put the same add
  in the spec's [`stock_adds`](#stock-adds).
- An existing manual item (`manual_item_id` / `manual_item { id }`) with too
  little stock is refused too: `Insufficient stock: manual item BCX26125 (…)
  has 0, needs 1. It is already sold; for a different piece, use
  manual_item { create } instead`. A manual item the spec creates starts with
  its line's quantity as stock (3.5 for 3.5 m of fabric), so its sale leaves 0.
- Warned (non-blocking): a line discount over 30% (the screen asks to
  confirm), paying more than the total (recorded as is).
- Warned (non-blocking) when the spec would **create** a customer
  (`create`, or `create_if_missing` for an unknown phone), likely
  duplicates: existing customers with the same first and last name
  (ignoring case; no last name matches no last name), with their id and
  phone, and existing customers whose phone is one digit off the slip's
  `+91` phone (a misread digit). Two cheap reads: a name match, and one
  `phone in (…)` over the 90 one-digit variants. If it is the same person,
  bill `customer { id }` instead. `bill create` repeats these warnings in
  its output.
- No `bill_payments` row: like the screen, a fully paid bill records payment
  as `payment_amount` + `salesmethodid` on the bill.
- Part-paid (`balance_due` > 0), as the screen's partial finalize: the bill
  gets `paymentstatus: "partial"`, `net_amount` (bill total), `final_amount`
  (`amount + balance_due`) and `payment_amount` (first payment), plus one
  `bill_payments` row for the first payment, dated the bill date at midday
  (no `recorded_at` when the bill is dated today). Stock moves with reason
  `bill_partial_finalize`. The rest is recorded later on the Bills screen.
- Inventory lines get `cost_price: null` and manual lines the item's cost, as
  on the screen. A manual line takes its item's stock by its exact quantity
  (fabric by the metre), as a variant's is taken.

### Stock adds

A slip whose piece is on the shelf but not in the inventory needs a
`stock add` before its bill. `stock_adds` puts that in the spec, so the
slip is still one command:

```json
{
  "customer": { "id": 453 },
  "date": "2026-10-22",
  "payment": { "method": "Cash", "amount": 1495 },
  "stock_adds": [{ "code": "BC25385", "size": "3XL|46", "color": "Pink", "qty": 1, "new_variant": true }],
  "items": [{ "product": "BC25385", "size": "3XL|46", "color": "Pink", "qty": 1 }]
}
```

- Each entry is checked by the same code as `stock add` (`addStockByCode`):
  same size/colour matching, same refusals (reported as `stock_adds[0]: …`)
  and the same activity-log entries. `new_variant` is `--new-variant`.
  Unknown fields are refused.
- `bill preview` (and `--dry-run`) writes nothing: it lists the adds in
  `stock_adds` (`productid`, `size`, `color`, `variantid`, `created`, `qty`,
  `stock_before`, `stock`) and checks the bill as if they were applied, so
  `stock` shows the stock after the add. A variant an add would create has
  no id yet: the preview shows it as `new:<code>:<colour>/<size>`, in
  `stock_adds` and in `bill_items`.
- **Finalized and part-paid bills: one transaction.** `bill create` sends the
  adds and the bill in one `bill_save_with_stock_adds` call
  (`schema/migration_bill_save_with_stock_adds.sql`): the database adds the
  stock (or creates the variant, under an id the CLI makes, which the bill
  lines also use), then runs `bill_save`. If anything fails, nothing is
  saved, neither the stock nor the bill, so there is nothing to undo. Its
  output adds `stock_adds` (each add, with the real variant id).
- **Drafts: separate writes.** A new draft has no `bill_save` op, so its adds
  are applied first with `stock add`'s writes (`stock_adjust` or the
  new-variant insert), then the draft is saved. If the draft then fails, the
  adds are undone, newest first: a variant an add created is deleted again
  (the database refuses that while anything references it, e.g. a bill line
  or a cart; then it is kept), and any other add is taken back with
  `stock_adjust` (activity log `Decreased stock of …, added for a bill that
  failed (via CLI)`). The error ends with what happened, e.g.
  `— stock adds undone: BC25385 Pink / 3XL|46 +1 variant removed`, or
  `— stock adds NOT all undone, fix them in the inventory editor: …` naming
  each one to fix by hand.

### Draft bills

A slip marked "not confirmed yet" is saved as a draft: add `"draft": true`.
It is written exactly as the billing screen's **Save Draft** on a new bill
(`BillingForm.handleSaveDraft`):

```json
{
  "draft": true,
  "customer": { "phone": "9000000001" },
  "date": "2026-10-22",
  "payment": { "method": "Cash", "amount": 500 },
  "notes": "Paper bill 420, not confirmed yet",
  "salespersons": ["Asha"],
  "items": [{ "product": "BC-252051", "color": "Mustard", "qty": 1, "amount": 1800 }]
}
```

- `paymentstatus: "draft"`, `finalized: false`. The bill gets its
  `FY26-000NNN` number when saved, like any bill, so `slip add`, `--photo`
  and `bill get --number` work on it.
- Stock is taken now, as on the screen (stock reason `bill_draft_create`),
  and the same "not enough stock" refusal applies; `skip_stock` works as
  for a finalized bill.
- What the screen does not check on a draft, the CLI does not either:
  `customer` may be left out (a walk-in draft), `payment` may be left out,
  and `payment.method` / `payment.amount` are stored as given
  (`salesmethodid`, `payment_amount`; `balance_due` becomes the screen's
  `final_amount`, `amount + balance_due`). No ₹100 payment check, no
  balance discount: the total is the line total as it stands
  (e.g. 1800.08, not 1800). Those happen when the draft is finished.
- Still refused: everything about the lines (unknown product, discount over
  50%, amount above MRP, not enough stock), an unknown payment method or
  location, unknown salespersons.
- No `bill_payments` row; no PDF (`bill pdf` refuses a draft, and the Bills
  screen offers no PDF until it is finalized). Finish it (Finalize or Partial
  Payment) on the Billing screen.

Writes, in the screen's order: the `bills` row, its `bill_items` (if they
fail, the bill row is deleted again, as the screen does), its
`bill_salespersons`, then one `stock_adjust` per variant and one
`manual_item_stock_adjust` per manual item, then an
activity-log entry `Created draft bill #… for … — ₹…, N items (via CLI)`.
These are separate writes, not one transaction, because the database's
`bill_save` has no draft op and the screen saves a new draft this way. A
salespersons or stock write that fails keeps the draft: it is listed in
`save_errors` and the exit code is `1`; fix it on the Billing screen.
Output is as for a finalized bill with `"status": "draft"`.

### Exchanges

A slip where the customer brings back something bought on an earlier bill
and buys something else on the same visit: the returned goods' credit pays
for part of the new bill and the slip shows the difference paid. Add an
`exchange` block:

```json
{
  "customerid": 453,
  "date": "2026-11-14",
  "payment": { "method": "Mixed", "amount": 2250 },
  "notes": "Paper bill 999; GPay 1250 + Cash 1000",
  "exchange": {
    "bill": "FY26-000123",
    "items": [{ "product": "BC26001", "size": "M|38", "color": "Black", "qty": 1, "reason": "size" }]
  },
  "items": [
    { "manual_item": { "create": { "name": "3Pc Suit", "category": "S3P", "mrp": 7995, "cost": "ZCHEZ", "size": "38", "color": "Black" } }, "qty": 1, "amount": 5000 }
  ]
}
```

It is recorded exactly as the app records an exchange: first the Exchange
page's step (`exchange_record`: the returned pieces go back in stock and the
credit is saved for the customer), then the bill screen's Finalize
(`bill_save` with the credit applied and the exchange linked to the new
bill). The credit is never typed in: it is what the returned lines sold for,
worked out as the Exchange page does (`calcItemCredit`: the line's total for
the units returned).

| Field | Required | Notes |
|---|---|---|
| `exchange.bill` | yes | the bill the goods were bought on (`FY26-000NNN`); must be fully paid and the same customer's |
| `exchange.items[]` | yes | each returned line: `product` (+ `size`, `color`, matched case-insensitively) or `bill_item_id` (from `bill get`), and `qty`: a whole number, or for fabric sold by the metre exactly the whole length left on the line (`3.5` for 3.5 m, `2` for 2 m). `reason` is optional |
| `exchange.balance` | only when the credit is more than the new bill | `"store_credit"` (the leftover goes on the customer's store credit) or `"cash_refund"` (paid back in cash), the screen's two choices. Refused when nothing is left over |
| `exchange.exchange_ids` | instead of `bill` + `items` | credit already recorded and not spent yet (on the Exchange page, or by a `bill create` whose bill then failed): e.g. `[77]`. Nothing is returned or restocked again |

How it becomes a bill, as on the screen:

- The new bill's lines and total are what was sold (here 5000). The credit
  comes off that total: `exchange_credit_used`, and `payment.amount` is what
  is left (5000 − 2750 = 2250). The ₹100 payment check and the balance
  discount work on what is left after the credit. `payment` may be left out
  when the credit covers the whole bill.
- `bill.exchange_source_bill` is the source bill's number;
  `exchange_cash_refund` is the leftover for `"cash_refund"`; for
  `"store_credit"` the leftover is sent as `exchange_balance_to_credit`.
- Part payment works as without an exchange: `amount + balance_due` is
  what is left after the credit.
- A new line of the same variant as a returned piece counts the returned
  piece as back on the shelf (the return is recorded first).

Refused in the preview, before anything is written (each the same rule the
database applies, so credit is never given twice):

- the source bill does not exist, is not fully paid (part-paid, draft,
  cancelled), is an online order not delivered yet, or is another
  customer's;
- a returned line not on the source bill (the error lists its lines), a
  product on two lines with no size/colour to tell them apart (give
  `bill_item_id`), the same line twice, a line with an alteration charge;
- more than is left to return on a line: the error says how much was
  returned before and, for each earlier exchange, whether its credit was
  spent (on which bill) or not. Unspent credit for that return is used with
  `"exchange_ids"`, not by returning the piece again;
- part of a metre line (1.5 or 1 of a 3.5 m line, 1 of a 2 m line):
  fabric goes back whole, and the error gives the length to use; a
  fraction on any other line (0.5 of a piece);
- more credit than the source bill holds (what was paid for it, less
  credit already given from it);
- `exchange_ids` that do not exist, were already spent, or are another
  customer's;
- credit above the new bill without `balance`; nothing paid while something
  is left to pay; `exchange` on a draft.

Warned (non-blocking): the exchange is more than 7 days after the source
bill (or its delivery) — the Exchange page asks to allow it, and
`bill create` writes the same activity entry it does; a source bill saved
with "don't reduce stock" (the return still puts the piece back, as in the
app). A returned manual item goes back in stock like a variant:
`exchange_record` finds it from the returned line. Fabric sold by the
metre (a line with unit type `meter`) goes back whole or not at all (owner,
2026-11-22): `"qty": 3.5` for a 3.5 m line, for the line's whole total as
credit. That needs `schema/migration_exchange_fractional_qty.sql` on the
database; until the owner runs it, a fractional `qty` passes the preview
but `bill create` stops at `exchange_record` (`invalid input syntax for
type integer`) before the exchange or the bill is written, and a part
return in whole metres (1 of 3.5 m) is still taken by the database (the
preview already refuses it). Piece returns work the same either way.

Not done: the return receipt PDF (the Exchange page prints one; the bill's
PDF shows the credit), a return with no new purchase (use the Exchange
page).

**Return date.** The exchange's `returndate` is the slip date (at midday),
passed to `exchange_record` as `p_returndate`. That needs
`schema/migration_exchange_record_return_date.sql` on the database; until
the owner runs it, `bill create` refuses an exchange with `the owner must
run schema/migration_exchange_record_return_date.sql first` before the
exchange or the bill is written (a customer or manual item the spec creates
is made first; the error's `NOTE` says so). `bill preview` works either way. The Exchange page has no date
field, so its exchanges are still dated when they are entered.

**Two writes, as in the app.** `bill create` runs `exchange_record`, logs
`Exchange recorded on bill #FY26-000123 — 1 item, ₹2750.00 credit (via CLI)`,
then saves the bill with `bill_save`. If `exchange_record` refuses, nothing
is saved. If the bill then fails, the exchange stays recorded (stock back,
credit unspent) and the error ends with the exact block to re-run with:
`re-run with "exchange": {"exchange_ids": [77]}`.

### bill preview

```bash
node scripts/admin-cli.mjs bill preview --spec bill.json
```

Read-only. Output: `status` (`finalized`, `partial` or `draft`: what the bill
would be saved as), `customer` (`null` for a walk-in draft), `creates` (the customer row and manual item
rows that would be created first, with the ids the manual items will get;
`customer` there means `bill.customerid` is filled in on create),
`payment_method`, `location`, `salespersons` (`salesperson_id`, `name`, `[]`
if none), the exact `bill` row and `bill_items` rows that
would be inserted (bill number and ids are assigned on create), `stock` (per variant: `variantid`, `productid`, `size`, `color`,
`stock_before`, `change`, `stock_after`; per manual item: `manual_item_id`, `name`, `stock_before`, `change`, `stock_after`), `stock_adds` (the [stock adds](#stock-adds) applied with the bill, `[]` if none), `totals` (`mrp_total`, `line_discounts`, `balance_discount`,
`grand_total`, `paid`, and `balance_due` on a part-paid bill), `first_payment`
(the `bill_payments` row a part-paid bill gets, else `null`) and `warnings`.
With an [exchange](#exchanges), also `exchange`: `kind` (`return` or
`recorded`), `source_bill`, `returned` (per line: `bill_item_id`, `code`,
`name`, `size`, `color`, `qty`, `credit`, and `stock` `{ variantid,
stock_before, stock_after }` (or `{ manual_item_id, … }` for a manual item)
for the piece going back; for `exchange_ids`, each exchange), `exchange_ids`, `credit`,
`credit_used`, `balance` (credit left over), `balance_to`, `record` (the
exact `exchange_record` arguments) and `outside_window`; `totals` adds
`exchange_credit` and `net_due` (what is left to pay after it).

### bill create

```bash
node scripts/admin-cli.mjs bill create --spec bill.json --dry-run   # same as preview
node scripts/admin-cli.mjs bill create --spec bill.json
node scripts/admin-cli.mjs bill create --spec 319.json --photo "BC Bills/319.jpeg"
```

`--photo` (repeatable, e.g. front and back) attaches the paper slip the bill
was entered from; see [Slip photos](#slip-photos). Photos are shrunk and
checked before the bill is written, so a bad photo stops the command with
nothing saved. With `--dry-run` the output lists each photo's upload size.

Writes, in order: the customer and manual items from `creates` (if any), the
[exchange](#exchanges)'s `exchange_record` (if it returns goods), the
spec's [stock adds](#stock-adds) (if any, inside the same call, as
`bill_save_with_stock_adds`), then as the screen does, one `bill_save` call that saves the bill (the database
assigns the next `FY26-000NNN`), its items, its salespersons, the stock change per inventory
variant and manual item (none with `skip_stock`) and, on a part-paid bill, the first payment,
all in one transaction: if any part fails, nothing is saved and no bill is
left to delete. Then an activity-log entry
`Finalized bill #… for … — ₹…, N items (via CLI)`.

```json
{
  "billid": 353,
  "bill_number": "FY26-000336",
  "status": "finalized",
  "customer": { "customerid": 453, "first_name": "Test", "last_name": "Customer", "phone": "+919000000001" },
  "totals": { "mrp_total": 2395, "line_discounts": 594.92, "balance_discount": 0.08, "grand_total": 1800, "paid": 1800 },
  "stock": [ { "variantid": "29c3…", "productid": "BC252051", "size": "FREE-SIZE", "color": "Mustard", "stock_before": 1, "change": -1, "stock_after": 0 } ],
  "negative_stock": [],
  "warnings": []
}
```

The output also has `salespersons` and `created` (`customer`, `manual_items`), and with an
[exchange](#exchanges) `exchange` (`source_bill`, `exchange_ids`, `credit`, `credit_used`,
`balance`, `balance_to`, `returned`). `negative_stock`
lists any variant (`variantid`, `stock`) or manual item (`manual_item_id`, `stock`) the save took below zero, which can
only happen if stock was sold elsewhere after the preview; recount those. If the bill
fails after a customer or manual item was created, the error ends with
`NOTE: … were already created` — re-run with `customer { id }` /
`manual_item { id }` so they aren't created twice.

With `--photo`, the output adds `slip_photos` (`id`, `billid`, `path`,
`uploaded_at`, `file`). A photo that fails after the bill is saved does not
undo the bill: it is listed in `slip_photo_errors` with a `retry` command
(`slip add --id …`), and the exit code is `1`.

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

Read-only. The full `bills` row plus `is_draft` (`true` for a draft: not a
sale yet, no PDF, finished on the Billing screen), `payment_method`, `location`,
`customer`, `salespersons` (the bill's `bill_salespersons`, each
`salesperson_id` and `name`), `items` (each inventory line with its variant's `size`, `color`
and `current_stock`), `payments` (`bill_payments` rows) and `slip_photos`.
`null` if no such bill. The row's own `salesperson_ids` column is filled by a
trigger from per-line salespersons only, so it is usually `[]`; read
`salespersons` instead.

### bill pdf

```bash
node scripts/admin-cli.mjs bill pdf --number FY26-000412
node scripts/admin-cli.mjs bill pdf --id 485 --app-url http://localhost:3000
```

Makes (or remakes) a finalized bill's PDF, the same file as the Bills
screen's "Regenerate PDF" button. The app draws the PDF in the browser, so
the command opens the admin Bills screen (default
`https://www.bindalscreations.com`, or `--app-url`) in headless Google
Chrome, signed in with your CLI session, and clicks that button for the bill.
Needs Google Chrome installed (or `npx playwright install chromium`). Takes
about 15 seconds.

Output: `billid`, `bill_number`, `pdf_url` (the new file in the `invoices`
bucket) and `previous_pdf_url`. Success is checked in the database:
`pdf_url` must have changed. If the app refreshes the login while it runs,
the new session is saved back to the CLI's session file.

Errors: `No bill numbered …`, `Bill … is not finalized` (a draft), `Bill … is cancelled` (exit 2); the app
not accepting the session, the app's "PDF generation failed" message, or
`pdf_url` unchanged (exit 1).

## Slip photos

Photos of the handwritten slip a bill was entered from, kept so bills can be
audited against paper later. Optional. Stored in the private `bill-slips`
bucket (admins only), one `bill_slip_photos` row per photo. The billing
screen has the same section ("Paper slip photo": pick or drop photos).

Photos are shrunk on your Mac before upload with the built-in `sips`: long
side 2000 px, JPEG, so iPhone HEIC works too (a 3-5 MB camera photo becomes
a few hundred KB). The bucket refuses anything that is not a JPEG or is over
2 MB, so an unshrunk file can never be stored.

```bash
node scripts/admin-cli.mjs slip add --number FY26-000336 --file 319.jpeg [--file 319_back.jpeg] [--dry-run]
node scripts/admin-cli.mjs slip list --number FY26-000336        # or --id <billid>
node scripts/admin-cli.mjs slip download --photo <photo id> --out audit/   # saves <photo id>.jpg
```

For an audit: `bill get` shows the bill with its `slip_photos`; `slip download`
saves each photo so it can be read next to the bill.

### slip finish

One command for a slip whose spec has passed `bill preview`: `bill create`
with the photo, then `bill pdf` with the **bill number** the save returned
(never the bill id), then `bill get`, and a check of the saved bill against
the spec. Each step is the CLI's own command, so it writes exactly what
they write.

```bash
node scripts/admin-cli.mjs slip finish --spec 441.json --photo "BC Bills/441.jpeg"
node scripts/admin-cli.mjs slip finish --spec 441.json --photo 441.jpeg --dry-run   # = bill create --dry-run
```

`--photo` is required (repeatable); `--app-url` is passed to `bill pdf`. A
draft spec gets no PDF (`"pdf": "skipped: …"`). Output, compact:

```json
{
  "billid": 488,
  "bill_number": "FY26-000415",
  "status": "finalized",
  "pdf_url": "https://…/invoices/…pdf",
  "slip_photos": ["<photo id>"],
  "verify": {
    "ok": true,
    "mismatches": [],
    "saved": {
      "bill_number": "FY26-000415", "status": "finalized",
      "customer": { "customerid": 453, "name": "Test Customer", "phone": "+919000000001" },
      "date": "2026-10-22",
      "lines": [{ "code": "BC252051", "color": "Mustard", "size": "FREE-SIZE", "qty": 1, "amount": 1800 }],
      "total": 1800, "paid": 1800, "method": "Cash", "salespersons": ["Asha"]
    }
  },
  "ok": true
}
```

`verify` compares the saved bill with the spec: customer (id, phone, or the
new customer's name), date (the shop's day), status (finalized / partial /
draft), number of lines, each line's product code (and colour / size if
the spec gives them), variant id or manual item, qty, alteration and amount
(to the rupee, after the line's share of the balance discount), the total
(`amount + balance_due` plus the bill's exchange credit, not for a draft),
the exchange (credit on the bill, and the source bill number), the amount paid, the payment
method and the salespersons. Each difference is one `mismatches` line, e.g.
`items[0] amount: spec 1800, bill 1700`. Paying more than the line total
(a preview warning) shows as a `total` mismatch.

Exit code `1` with `"ok": false` when anything differs, or when a step after
the save failed: the PDF (`pdf_error`, with `pdf_retry`, e.g.
`bill pdf --number FY26-000415`), a photo (`slip_photo_errors`), a draft's
salespersons or stock (`save_errors`), or `negative_stock`. None of these
undo the bill; fix them and check with `bill get`. Warnings and applied
`stock_adds` are listed too. A refused bill fails before anything is saved,
as for `bill create`.

### Checked against the app

A read-only run over the 75 most recent finalized app bills (rebuilt as
specs, then `bill preview`) matched 57 exactly. The rest differ by paise:
mostly app bills whose total landed below the amount paid (e.g. 999.94 on a
1000 payment) where the CLI lands on the amount paid, plus per-line splits the
rebuild can't recover. One app bill had a 50.57% line discount, which the CLI
refuses.
