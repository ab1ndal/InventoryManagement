# Fabric returned whole (fractional-quantity exchange)

Branch `feat/fabric-whole-return`, 2026-11-22. Owner decision (2026-11-22): fabric sold by the
metre is returned either whole (the full quantity on the bill line, e.g. 3.5 m) or not at all.
Today a 3.5 m line cannot be returned at all: `exchanges.quantity` is `int4` and
`exchange_record` casts the quantity to `int`.

## 1. Research (live, read-only, 2026-11-22)

Live already has `migration_exchange_record_return_date.sql` (4-argument `exchange_record`) and
`migration_manual_item_stock.sql` (`manual_items.stock numeric(10,3)`, `_manual_stock_apply`).

Everything that reads or writes `exchanges.quantity` (live `pg_get_functiondef`, client grep):

| Reader / writer | What it does with it | Fractional value safe? |
|---|---|---|
| `exchange_record` | `v_qty int := (e->>'quantity')::int`; `v_used numeric` sum; cap math; `_stock_apply` / `_manual_stock_apply` (both take numeric); insert | **No**: the cast refuses `3.5` (22P02). Changed |
| `bill_cancel` | `sum(e.quantity)` per variant / manual item into `v_qty numeric` | yes |
| `_bill_items_exchange_lock` (trigger) | `v_exchanged numeric` | yes |
| `_online_return_free_units` | `(shipped - … - sum(e.quantity))::int` | online lines are whole pieces (storefront sells products by the piece; 0 fractional variant lines live), so the sum stays whole. Unchanged |
| `_online_bill_offset` | inserts `ri.units` (int) | yes (int → numeric) |
| `bill_save`, `bill_edit`, `_online_leg_complete_credit`, `online_order_mark_collected` | read `credit_amount` / `new_billid` only | n/a |
| Views, constraints, indexes, policies, triggers on `exchanges` | no view depends on the table; constraints are FKs + PK; indexes do not include `quantity`; policy `admin_only` | the type change is free |
| App / CLI JS (`ExchangePage`, `BillingForm`, `exchangeHelpers`, `lib/exchanges.js`, `bills.js`) | all read it through `Number(...)` | yes (PostgREST sends numeric as a JSON number) |

Data: 11 exchanges, none on a metre line. 16 metre lines (`bill_items.unit_type = 'meter'`), 14
fractional, 2 whole (e.g. 2 m). No fractional line is a variant (all are manual `BCX` items), but
the rule below does not depend on that.

### Not true / gotchas

- The Exchange page's quantity box already accepts 3.5 (`Number(v)`, no step); only the RPC
  refused it, with a raw cast error. A piece line could likewise be sent 1.5 and got the same
  cast error.
- `test_manual_item_stock.sql` §7 returns **1 whole metre of a 3.5 m line** and expects it to be
  accepted. Whole-number returns of any line stay exactly as now (see spec), so it keeps passing.

## 2. Spec

- `exchanges.quantity` becomes `numeric(10,3)` (as `bill_items.quantity`).
- `exchange_record` takes the quantity as numeric (rule tightened by the owner, 2026-11-22):
  - a **metre line** (`bill_items.unit_type = 'meter'`) only whole: the quantity must equal what
    is left to return on it (`bi.quantity` − earlier exchanges), fractional or not. 3.5 of 3.5 m
    and 2 of 2 m are accepted; 1.5 or 1 of 3.5 m and 1 of 2 m are refused;
  - **any other line**: whole numbers only, partial returns allowed, every check as now.
  Refusals: `EXCHANGE_WHOLE_LINE` (detail: bill_item_id, quantity, left). Credit cap math
  unchanged and exact (numeric): a whole-line return's cap is the line total. A fraction with
  more than 3 decimals can never equal the line's quantity, so nothing is rounded on insert.
- **Exchange page**: a metre line always shows a "Return all 3.5" (or "Return all 2") checkbox
  instead of the number box. Other lines keep the number box, now truncated to whole numbers
  (it could send 1.5 before, which failed).
- **CLI** (`exchange.items[].qty`): a metre line takes exactly what is left on it, anything else a
  whole number; refused in `bill preview` otherwise, with the length to give.
- Error text for `EXCHANGE_WHOLE_LINE` in both clients.

### Out of scope / owner decisions

- (Decided 2026-11-22, owner) Metre lines go back whole, whole-metre parts included (above).
- A fractional line that is not a metre line (none live) takes whole numbers only.
- Online returns: unchanged (piece-only).

## 3. Deploy order and merge safety

The migration and the code are independent: the code is **safe to merge before the migration**.
Before it, the Exchange page's checkbox sends 3.5, which the old RPC refuses with the cast error
(as typing 3.5 does today), and the CLI preview passes but `bill create` stops at
`exchange_record` before anything is written. A whole-number metre line (2 m) returned whole
works before it too. Until the migration, the database still takes a part return in whole
metres (1 of 3.5 m) sent by an old client; the new page and CLI never send one. Piece lines
behave as today either way. The migration alone (before the merge) changes nothing for piece
lines; on a metre line the old page could then only return the whole length by typing it.

## 4. Plan

- [x] Research (above).
- [x] `schema/migration_exchange_fractional_qty.sql`: column type; `exchange_record` copied from
      live with `v_qty numeric` and the whole-line check. Diff against live: 3 lines changed
      (`v_qty int` → `numeric`, `::int` → `::numeric`, `trim_scale(v_used)` in the
      "already returned" message so it still reads "1 of 3", not "1.000 of 3"), 8 added (the
      `EXCHANGE_WHOLE_LINE` check, keyed on `unit_type = 'meter'`). Nothing removed.
- [x] `schema/test_exchange_fractional_qty.sql` (37 checks): 13 pass / 24 fail before the
      migration, 37 / 0 after.
- [x] `exchangeHelpers.js`: `returnableLeft`, `isWholeOnlyLine`, `isAllowedReturnQty`. Tests.
- [x] `ExchangePage.js`: checkbox for metre lines, whole numbers for other lines; error text.
- [x] `lib/exchanges.js`: qty rule; error text. Tests.
- [x] `docs/admin-cli.md` Exchanges.
- [x] `test_manual_item_stock.sql` §7 returns its 3.5 m line whole (was 1 whole metre).
- [x] `test_online_returns.sql`: grant checks name the 4-argument `exchange_record`.
- [x] Verify after the tightened rule (2026-11-22), same chain, rebuilt: test_exchange_fractional_qty
      37/0, test_bill_draft_finish 172/0, test_bill_exchange_lines 48/0,
      test_exchange_record_return_date 12/0, test_bill_excess_credit 54/0,
      test_bill_double_cash 35/0, test_bill_add_payment 47/0, test_bill_cancel 56/0,
      test_bill_save 123/0, test_voucher_states 92/0, test_bill_status_states 99/0,
      test_manual_item_stock 43/0, test_online_returns all passed. test_online_orders_refunds and
      test_online_orders_holds stop at the same unrelated fixture errors as before. App suite
      192 suites / 2066 tests; `node --test scripts/admin-cli/*.test.mjs` 11/11.
- [x] First verify (before the tightened rule, superseded). Local DB rebuilt from the chain in tasks/manual-item-stock-plan.md §6
      plus `migration_manual_item_stock.sql`; `bill_save`, `bill_cancel`, `bill_edit`,
      `exchange_record`, `_bill_items_exchange_lock`, `_online_bill_offset`,
      `_online_return_free_units` matched live byte for byte before the migration. After it:
      test_exchange_fractional_qty 33/0, test_bill_draft_finish 172/0,
      test_bill_exchange_lines 48/0, test_exchange_record_return_date 12/0,
      test_bill_excess_credit 54/0, test_bill_double_cash 35/0, test_bill_add_payment 47/0,
      test_bill_cancel 56/0, test_bill_save 123/0, test_voucher_states 92/0,
      test_bill_status_states 99/0, test_manual_item_stock 43/0 (its "1 whole metre of 3.5 m"
      check still passes). test_online_returns stops at its last block's grant checks, which
      name the dropped 3-argument `exchange_record` (stale since the return-date migration);
      a scratch copy with the 4-argument signature passes in full ("all passed"), so the
      online-return paths work with the numeric column. test_online_orders_refunds and
      test_online_orders_holds stop at the same unrelated fixture errors as before.
      App suite 192 suites / 2060 tests pass (dummy `REACT_APP_SUPABASE_*`);
      `node --test scripts/admin-cli/*.test.mjs` 11/11.
- [ ] Owner: run `schema/migration_exchange_fractional_qty.sql`; merge in either order (§3).
