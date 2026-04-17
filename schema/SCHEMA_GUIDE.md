# Schema Guide — Bindals Creation Retail Inventory

## Table of Contents
1. [Table Reference](#table-reference)
2. [Domain Map](#domain-map)
3. [For Claude: How to Look Up Schemas](#for-claude-how-to-look-up-schemas)
4. [Redundancies & Migration Notes](#redundancies--migration-notes)

---

## Table Reference

### Core Inventory

| Table | File | Purpose |
|-------|------|---------|
| `products` | `products.sql` | Master product catalog. Each row is one SKU (`BC{YY}{###}`). Holds name, description, fabric, purchase price, retail price, category FK, and Drive URL. |
| `productsizecolors` | `productsizecolors.sql` | Size/color variants per product. Each row is one variant (`variantid` UUID). Tracks `stock` count. Child of `products`. |
| `categories` | `categories.sql` | Lookup table for product categories (e.g., "Saree", "Blouse"). Referenced by `products` and `manual_items`. |
| `productimages` | `productimages.sql` | Image URLs for products. Ordered by `displayorder`. Child of `products`. |
| `mockups` | `mockups.sql` | One row per product tracking social/marketing content status: mockup created, IG post, IG reel, WhatsApp, video, etc. Auto-created by trigger on product insert. |
| `mockups_view` | `mockups_view.sql` | View joining `mockups`, `products`, `categories`, `productsizecolors` — adds human-readable category, sizes, colors, year/number codes. Use this for mockup display queries. |
| `suppliers` | `suppliers.sql` | Supplier contact records. Referenced by `stocktransactiongroups`. |

### Stock Transactions

| Table | File | Purpose |
|-------|------|---------|
| `stocktransactiongroups` | `stocktransactiongroups.sql` | Groups a batch of stock movements (e.g., one purchase delivery). Has date, optional supplier FK, and note. |
| `stocktransactions` | `stocktransactions.sql` | Individual stock adjustments. Each row ties to a `variantid` and a `transactiongroupid`. `type` is `'in'` or `'out'`. PK is `(transactionid, variantid)`. |

### Billing & Sales

| Table | File | Purpose |
|-------|------|---------|
| `bills` | `bills.sql` | Invoice header. Holds customer, date, totals, payment details, sales location/method, applied discount codes, PDF URL, and bill number. Bill number auto-set by trigger from `bill_sequences`. |
| `bill_items` | `bill_items.sql` | Line items on a bill. Stores a snapshot of `product_name`, `product_code`, `category` (denormalized for historical accuracy), plus MRP, quantity, GST, discounts, subtotal, total, cost price. FK to `productsizecolors.variantid` (nullable — manual items have no variant). |
| `bill_sequences` | `bill_sequences.sql` | Tracks last-used bill number per financial year (e.g., `"2025-26"`). Used by `set_bill_number()` trigger. |
| `bill_salespersons` | `bill_salespersons.sql` | Junction table linking bills to one or more salespersons. PK is `(billid, salesperson_id)`. |
| `salespersons` | `salespersons.sql` | Staff who make sales. Has name, hire date, active flag. |
| `saleslocations` | `saleslocations.sql` | Lookup: physical or virtual sale venue (e.g., "Store", "Exhibition"). |
| `salesmethods` | `salesmethods.sql` | Lookup: how the sale happened (e.g., "Walk-in", "Instagram"). |
| `manual_items` | `manual_items.sql` | Ad-hoc items not in product inventory (e.g., stitching supplies). Have their own ID prefix, category, size, color, MRP. Used as `bill_items` without a `variantid`. |

### Customers & Loyalty

| Table | File | Purpose |
|-------|------|---------|
| `customers` | `customers.sql` | Customer records. Phone is unique + E.164 format. Has ULID, loyalty tier, store credit, self-referential `referred_by` FK. |
| `discounts` | `discounts.sql` | Discount rules: flat, percentage, buy-X-get-Y, fixed_price, conditional, bundled_pricing. Can target categories or specific product IDs. Supports auto-apply, exclusivity, per-customer limits, date range. |
| `discount_usage` | `discount_usage.sql` | Audit log: which customer used which discount code on which bill. |
| `vouchers` | `vouchers.sql` | Store credit vouchers issued on exchange/return or manually. Tied to a customer, have expiry, value, and redemption bill FK. Source: `exchange`, `manual`, `promo`. |
| `exchanges` | `exchanges.sql` | Return/exchange records. References original `bill_items` row, quantity returned, credit amount, optional voucher issued. |

### Auth

| Table | File | Purpose |
|-------|------|---------|
| `profiles` | `profiles.sql` | Maps Supabase Auth `id` (UUID) to app role (`admin` / `superadmin`). One row per user. |

---

## Domain Map

```
categories ──────────────────────────┐
                                     ▼
suppliers → stocktransactiongroups → stocktransactions → productsizecolors ← products
                                                                ▲               │
                                                                │               ├── productimages
                                                                │               └── mockups
                                                                │
customers ← discount_usage ← discounts                         │
    │                                                           │
    └──────────────────── bills ───────────────────── bill_items
                           │  └── bill_salespersons        │
                           │                               └── exchanges → vouchers
                           └── bill_sequences
                           └── saleslocations
                           └── salesmethods

profiles (auth, standalone)
manual_items (used in bill_items without variantid)
```

---

## For Claude: How to Look Up Schemas

When editing code that touches DB tables, read the relevant SQL file directly:

```
schema/<tablename>.sql
```

**Quick lookup by feature area:**

| Feature | Read these files |
|---------|-----------------|
| Billing / invoices | `bills.sql`, `bill_items.sql`, `bill_sequences.sql`, `bill_salespersons.sql` |
| Products / inventory | `products.sql`, `productsizecolors.sql`, `categories.sql` |
| Stock movements | `stocktransactions.sql`, `stocktransactiongroups.sql` |
| Customers / loyalty | `customers.sql`, `vouchers.sql`, `exchanges.sql` |
| Discounts | `discounts.sql`, `discount_usage.sql` |
| Sales context | `salespersons.sql`, `saleslocations.sql`, `salesmethods.sql` |
| Auth / roles | `profiles.sql` |
| Mockup tracking | `mockups.sql`, `mockups_view.sql` |
| Manual (non-inventory) items | `manual_items.sql` |

**Key relationships to know:**
- `bill_items.variantid` → `productsizecolors.variantid` (NULL for manual items)
- `bill_items` denormalizes `product_name`, `product_code`, `category` — intentional, for invoice immutability
- `stocktransactions.variantid` → `productsizecolors.variantid`
- `discount_usage.code` → `discounts.code` (references by code text, not PK id)
- `exchanges.voucher_id` → `vouchers.voucher_id`

---

## Redundancies & Migration Notes

### 1. `customers` — Duplicate phone index (low risk, drop it)

`idx_unique_customer_phone` (UNIQUE) already provides B-tree lookup on `phone`.  
`idx_customers_phone` (non-unique btree on same column) is fully redundant.

```sql
-- migration: drop redundant phone index
DROP INDEX IF EXISTS idx_customers_phone;
```

### 2. `productsizecolors` — Redundant unique constraint on PK column (no-op, cosmetic)

`variantid` is already the primary key. The extra `UNIQUE` constraint `unique_variantid` is redundant.

```sql
-- migration: drop redundant unique constraint
ALTER TABLE productsizecolors DROP CONSTRAINT unique_variantid;
```

### 3. `stocktransactions` — `productid`, `size`, `color` duplicated from `productsizecolors` (moderate, data sync risk)

`stocktransactions` stores `productid`, `size`, `color` directly, but all three are fully derivable from `variantid` via `productsizecolors`. This creates a sync hazard if a variant's metadata ever changes.

**Migration** (breaking — verify no app code reads these columns directly first):

```sql
-- Step 1: verify no app usage
-- Step 2: drop the redundant columns
ALTER TABLE stocktransactions
  DROP COLUMN productid,
  DROP COLUMN size,
  DROP COLUMN color;
```

> Check `src/` for any direct reads of `stocktransactions.productid/size/color` before running. Use JOIN to `productsizecolors` instead.

### 4. `discount_usage.code` references `discounts.code` not `discounts.id`

Not a redundancy per se, but an unconventional FK — references a text natural key instead of the surrogate PK. Safe as long as discount codes are immutable after creation (the `UNIQUE` constraint on `discounts.code` ensures referential integrity). No migration needed unless codes need to be editable.
