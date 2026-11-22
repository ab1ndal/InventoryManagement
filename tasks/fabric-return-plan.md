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
- `exchange_record` takes the quantity as numeric. A quantity is accepted when it is
  - a whole number (any line, every check exactly as now), or
  - a fraction equal to what is left to return on the line (`bi.quantity` − earlier exchanges):
    the whole length. Anything else is refused with `EXCHANGE_WHOLE_LINE`
    (detail: bill_item_id, quantity, left). So 3.5 of 3.5 m is accepted; 1.5 of 3.5 m is refused.
  Credit cap math unchanged and exact (numeric): a whole-line return's cap is the line total.
  A fraction with more than 3 decimals can never equal the line's quantity, so it is refused too.
- **Exchange page**: a line whose quantity is not a whole number shows a "Return all 3.5"
  checkbox instead of the number box (whole length or nothing, the owner's rule). Piece lines
  keep the number box, now truncated to whole numbers (it could send 1.5 before, which failed).
- **CLI** (`exchange.items[].qty`): a whole number, or exactly what is left on a fractional
  line; refused in `bill preview` otherwise, saying to return the whole length.
- Error text for `EXCHANGE_WHOLE_LINE` in both clients.

### Out of scope / owner decisions

- (Open) Partial returns in **whole metres** of a fractional line (1 m of 3.5 m) stay accepted
  in the database and CLI, as today; the Exchange page offers only the whole length for such a
  line. If fabric must never be returned in part, say so (the rule would key on the line being
  fractional, or on `unit_type = 'meter'`).
- (Open) A whole-metre metre line (e.g. 2 m) is treated as a piece line: 1 of 2 m can be returned.
- Online returns: unchanged (piece-only).

## 3. Deploy order and merge safety

The migration and the code are independent: the code is **safe to merge before the migration**.
Before it, the Exchange page's checkbox sends 3.5, which the old RPC refuses with the cast error
(as typing 3.5 does today), and the CLI preview passes but `bill create` stops at
`exchange_record` before anything is written. Piece lines behave as today either way.
The migration alone (before the merge) also changes nothing for piece lines.

## 4. Plan

- [x] Research (above).
- [x] `schema/migration_exchange_fractional_qty.sql`: column type; `exchange_record` copied from
      live with `v_qty numeric` and the whole-line check. Diff against live: 3 lines changed
      (`v_qty int` → `numeric`, `::int` → `::numeric`, `trim_scale(v_used)` in the
      "already returned" message so it still reads "1 of 3", not "1.000 of 3"), 7 added (the
      `EXCHANGE_WHOLE_LINE` check). Nothing removed.
- [x] `schema/test_exchange_fractional_qty.sql` (33 checks): 13 pass / 20 fail before the
      migration, 33 / 0 after.
- [x] `exchangeHelpers.js`: `returnableLeft`, `isAllowedReturnQty`. Tests.
- [x] `ExchangePage.js`: checkbox for fractional lines, whole numbers for piece lines; error text.
      5 new tests fail against the old page, pass after.
- [x] `lib/exchanges.js`: qty rule; error text. 6 new/changed tests fail against the old code.
- [x] `docs/admin-cli.md` Exchanges.
- [x] Verify (2026-11-22). Local DB rebuilt from the chain in tasks/manual-item-stock-plan.md §6
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
