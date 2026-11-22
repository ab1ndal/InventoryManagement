# Manual-item stock (billing a BCX item lowers its stock)

Branch `feat/manual-item-stock`, 2026-11-22. Owner request: billing a manual item (`BCX…`,
table `manual_items`) must reduce its stock the way a product variant's is reduced, and a
cancel, edit or exchange must give it back.

## 1. Research (live, read-only, 2026-11-22)

Live function bodies were read with `pg_get_functiondef` and the local test DB was rebuilt from
the migration chain until `bill_save`, `_bill_lines_save`, `bill_cancel`, `bill_edit`,
`exchange_record`, `_stock_apply` and `stock_adjust` matched live byte for byte (chain in §6).

### How variant stock moves today

| Path | Where | What happens to variant stock |
|---|---|---|
| New finalized / part-paid bill | `bill_save` (`finalize_create`, `partial_create`) | `_stock_apply(variant, -qty)` per variant, a `bill_stock_moves` row each; with `skip_stock` (screen: "Don't reduce stock", bill `stock_reduced = false`) a 0 move. Stock may go below 0: the save goes through and returns `negative_stock` |
| New draft | client: `BillingForm.handleSaveDraft` / CLI `insertDraft` | inserts `bills` + `bill_items` directly, then one `stock_adjust(variant, -qty, 'bill_draft_create')` per variant (skipped when "Don't reduce stock"). A failure only warns |
| Finish a draft | `bill_save` (`finalize_draft`, `partial_draft`) → `_bill_lines_save` | moves old lines minus new lines per variant |
| Edit an opened bill | `bill_edit` → `_bill_lines_save` | same; nothing when `stock_reduced is false` |
| Cancel | `bill_cancel` | gives back what the bill took (from `bill_stock_moves`, or its lines when it has none) less what was already exchanged, when `v_restock` (moves exist, or `stock_reduced`, or for a legacy `null` bill the `restore_older_stock` option) |
| Exchange (return) | `exchange_record` | `_stock_apply(variant, +qty)`, whatever the source bill's `stock_reduced` |
| Online checkout / hold / RTO / return | `online_order_*`, `stock_hold_set`, `online_return_receive` | variants only. The storefront sells products only; no online order can carry a manual item |

### Manual items today

- `manual_items.stock int4 not null default 1`. No sale path touches it. All 191 items read 1
  (177 sold on a live bill, 14 never sold).
- A bill line links to its manual item only by `bill_items.product_code = manual_item_id`,
  `variantid` null. No foreign key. 177 such lines; no `BCX` line without a `manual_items` row.
- `exchange_record` already has `elsif e->>'manual_item_id' … stock + qty`, but the Exchange page
  and the CLI always send `manual_item_id` null, so it never ran. That was correct while sales
  never took stock. No exchange has ever been recorded on a manual line (0 rows).
- Manual items are created at the moment of sale: the billing screen's Manual Item form and the
  CLI's `manual_item.create` insert the row and add it as a line. Nothing in the app lists
  manual items or their stock; only the CLI's `manual-item find [--in-stock]` reads it. The CLI can
  also bill an existing item again by id (`manual_item_id`, `manual_item: { id }`).
- Quantities: piece lines are whole numbers; metre lines (fabric, `unit_type = 'meter'`) are
  fractional (15 live metre lines, 14 of them fractional, e.g. 3.5). `exchanges.quantity` is
  `int4`; `exchange_record` casts the quantity to `int`.
- Live manual lines by bill state: finalized 170, part-paid 5, draft 5, cancelled 0;
  `stock_reduced` true 41, null (legacy, "took stock" per the owner) 137, false 0.
- No view, trigger or policy other than `admin_only` depends on `manual_items.stock`.
  `authenticated` has table grants (admins only, by the policy).

### Not true / dead ends

- "ExchangePage must pass the real manual_item_id": not needed. `exchange_record` can find the
  item from the line itself (`bill_items.product_code`), which also stops a client naming an
  item that is not on the bill. The client key is dropped instead (see §2).
- Logging manual moves in `bill_stock_moves`: its `variantid` is `uuid not null` and every reader
  groups by it. Manual stock is instead derived from the lines (the same rule `bill_cancel`
  already uses for bills without moves), so no table change is needed. No audit row per move is
  kept for manual items (out of scope).

## 2. Spec

A manual line is a bill line with `variantid` null whose `product_code` is a `manual_items` id.
Its quantity is taken exactly (3.5 m lowers stock by 3.5; nothing is rounded).

| Path | Manual-item stock |
|---|---|
| `bill_save` finalize / part-paid create | `-qty` per item (lines summed), unless `skip_stock` |
| New draft (screen and CLI) | `-qty` per item through new RPC `manual_item_stock_adjust` (reason `bill_draft_create`), as variants through `stock_adjust`, unless "Don't reduce stock" |
| Finish a draft, edit a bill (`_bill_lines_save`) | old lines minus new lines per item, unless the bill's `stock_reduced is false` |
| `bill_cancel` | gives back each item's line quantity less what was already exchanged from those lines, when variants would be restocked (`v_restock`) and `stock_reduced is distinct from false`. Listed in the result's `stock` as `{ manual_item_id, qty }` |
| `exchange_record` | `+qty` for the item on the returned line, found from the line's `product_code`, as for a variant (whatever the bill's `stock_reduced`). The client's `manual_item_id` key is ignored |
| Online paths | unchanged (no manual items online) |

- **Below 0**: as variants. The save goes through; `bill_save` and `bill_edit` list the item in
  `negative_stock` as `{ manual_item_id, stock }`. The CLI preview refuses a bill that would take
  an existing manual item below 0 (as it does for a variant), saying the piece is already sold and
  to create a new manual item for a different piece. The billing screen does not check manual
  stock before saving (it has none to show; see UI below).
- **New items**: the screen's Manual Item form and the CLI create a manual item with `stock` =
  the line's quantity (3.5 m of fabric → 3.5), so the sale brings it to 0. The column default
  stays 1 (`manual-item create` on its own keeps 1).
- **Type**: `manual_items.stock` becomes `numeric(10,3)` (as `bill_items.quantity`).
- **Exchanges of a fractional metre**: not supported. `exchanges.quantity` stays `int4` and
  `exchange_record` keeps its whole-number quantity; a metre line can be returned in whole metres
  only (as for a variant sold by the metre today). Supporting 0.5 m returns means changing
  `exchanges.quantity` to numeric and every reader of it (bill_cancel, bill_edit's exchange lock,
  Exchange page, CLI); no manual line has ever been exchanged. Owner decision, §5.
- **Backfill** (separate migration, run right after the main one): for every manual item,
  `stock = greatest(0, 1 - (sold - returned))`, where sold = quantity on lines of bills that are
  not cancelled and whose `stock_reduced is distinct from false` (drafts included: they took
  stock), and returned = exchanged quantity from those lines. Live preview (read-only, same
  statement as a select, end of 2026-11-22 session): 197 items all at 1, **183 change 1 → 0**,
  14 stay 1, none other (191 / 177 earlier the same day: slips are being entered). It is derived
  from bills only, so before the merge it gives the same answer re-run or run before the main
  migration. Not to be re-run after the merge (an item made for 0.5 m would go back to 0.5).
- **Admin UI**: no screen shows manual-item stock, before or after. The CLI's `manual-item find`
  shows the real figure (`--in-stock` now means unsold); its docs warning goes. The CLI's bill
  preview lists manual items in `stock` (`{ manual_item_id, stock_before, change, stock_after }`)
  and the exchange preview gives the returned manual piece's stock instead of `null`.

### Out of scope

- Per-move audit rows for manual items (`bill_stock_moves` is variant-only).
- Fractional exchange quantities (above).
- A stock field on the Manual Item form, a manual-item list/edit screen, and a screen-side stock
  check for manual lines.
- `manual-item create --stock` on the CLI (stays default 1).
- Changing the quantity of a manual line after the item was created on the screen moves stock by
  the difference (may go below 0, reported only to the CLI); no extra handling.

## 3. Deploy order and merge safety

1. Owner runs `schema/migration_manual_item_stock.sql`, then right after
   `schema/migration_manual_item_stock_backfill.sql`.
2. Then merge the app/CLI changes.

The code is **not** safe to merge before step 1: the new-draft path calls
`manual_item_stock_adjust` (missing → "Stock sync warning" toast, CLI `save_errors`), and a
fabric item created with stock 3.5 fails on an `int4` column. Before the migration, nothing
changes for anyone (main as today). Between the two migrations (minutes): sales take stock from
items still reading 1; the backfill then recomputes from the bills, so the order does not matter.
Between the migrations and the merge (keep it short): finalized and part-paid bills, edits,
cancels and exchanges already move manual stock (all server side); only a **new draft** saved
from the old screen or CLI does not take its manual items' stock, and a new manual item starts at
1 instead of its quantity (fabric over 1 m goes below 0). Check any manual draft saved in that
window. Do not re-run the backfill after the merge.

## 4. Plan

- [x] Research (above).
- [x] `schema/migration_manual_item_stock.sql`: column to numeric; `_manual_stock_apply`
      (internal), `manual_item_stock_adjust` (staff RPC); `bill_save`, `_bill_lines_save`,
      `bill_cancel`, `exchange_record` bodies copied from live with the manual-item steps added.
- [x] `schema/migration_manual_item_stock_backfill.sql` (no begin/commit: one statement, so the
      test can run it inside its own rolled-back transaction).
- [x] `schema/test_manual_item_stock.sql` (43 checks; before the migration it fails on the first
      checks and stops at the draft fixture) and `schema/test_manual_item_stock_backfill.sql`
      (12 checks; 5 pass / 7 fail with an empty backfill).
- [x] App: Manual Item form creates with stock = qty; new draft adjusts manual stock;
      Exchange page stops sending `manual_item_id`. CLI: same for drafts and creates, preview
      stock rows and refusal, exchange preview stock, docs.
- [x] Tests (2026-11-22): full app suite 192 suites / 2046 tests pass (worktree has no `.env`, so
      run with dummy `REACT_APP_SUPABASE_URL` / `_ANON_KEY`); `node --test` 11/11; the new JS
      tests fail (10) against the old code. SQL on the local DB after the migration:
      test_bill_draft_finish 172/0, test_bill_exchange_lines 48/0,
      test_exchange_record_return_date 12/0, test_bill_excess_credit 54/0,
      test_bill_double_cash 35/0, test_bill_add_payment 47/0, test_bill_cancel 56/0,
      test_bill_save 123/0, test_voucher_states 92/0, test_bill_status_states 99/0.
      test_online_returns, test_online_orders_refunds and test_online_orders_holds stop at the
      same error with and without the migration (stale fixtures, not this change).
- [ ] Owner: run both migrations, then merge (§3). Read-only checks are in each file's header.

## 5. Owner decisions

- (Decided 2026-11-22, owner) Fabric sold by the metre is **not** rounded: stock is in metres
  and a sale lowers it by the exact quantity (3.5 m → 3.5). Every give-back (cancel, edit,
  exchange) returns the exact amount. Piece items stay whole numbers.
- (Decided 2026-11-22, owner) Fabric is returned whole or not at all: see
  tasks/fabric-return-plan.md (`schema/migration_exchange_fractional_qty.sql`).
- (Open) Default chosen: a new manual item is created with stock = its line's quantity.
- (Open) Default chosen: the 14 unsold items keep stock 1; sold ones go to 0 (never below).

## 6. Local test DB chain

`scripts/test-db.sh up`, then (in order) the online chain of `schema/test_online_orders_holds.sql`,
the bill chain of `schema/test_bill_excess_credit.sql`, `migration_exchange_record_caps.sql`,
`migration_voucher_states.sql`, `migration_bill_save_drafts.sql`,
`migration_bill_edit_atomic.sql`, `migration_bill_money_rpc_only.sql`,
`migration_voucher_redeem_internal.sql`, `migration_exchanges_rpc_only.sql`,
`migration_bill_save_with_stock_adds.sql`, `migration_exchange_record_return_date.sql`,
`schema/manual_items.sql` (not in the bootstrap), then the files under test.
