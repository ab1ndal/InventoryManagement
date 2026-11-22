# CLI exchange (return + new purchase on one bill)

Branch `feat/cli-exchange`, 2026-11-22. Goal: a paper slip that records an exchange is entered
with `bill preview` / `bill create` / `slip finish`, written exactly as the app writes it.

## 1. Research: how the app records an exchange today

Two screens, two database calls, in this order:

1. **Exchange page** (`src/admin/pages/ExchangePage.js`). Staff search a **paid** bill
   (`paymentstatus = 'finalized'` only), pick lines and a quantity per line, and confirm. It calls
   the RPC **`exchange_record(p_billid, p_customerid, p_items)`**
   (latest body: `schema/migration_exchange_record_caps.sql`). In one locked transaction it:
   - refuses a bill that is not `finalized` (`EXCHANGE_BILL_NOT_FINAL`), an online order not yet
     delivered, a line not on the bill, a quantity above what is left to return
     (`item N already returned (x of y)`);
   - caps each line's credit at `calcItemCredit` (`exchangeHelpers.js`):
     `least(round(total*qty/quantity,2), round(total*(returned+qty)/quantity,2) - credit already given)`
     (`EXCHANGE_OVER_LINE`);
   - caps the bill's exchange credit in all (every `exchanges` row on its lines) at what the shop
     holds for it: the `bill_payments` sum, or `payment_amount` when there are none (online:
     `payment_amount + store_credit_used`) (`EXCHANGE_OVER_HELD`, ₹1 tolerance);
   - restocks: `_stock_apply(variantid, +qty)` for an inventory line; a manual line only when the
     item carries `manual_item_id`;
   - inserts one `exchanges` row per line (credit, qty, reason, customer = the source bill's
     customer, product name/code snapshot) with `new_billid` null = **unspent credit**, and returns
     the new ids. The page writes an activity entry
     `Exchange recorded on bill #… — N items, ₹X credit`, prints a return receipt and navigates to
     a new bill with `exchangeCredit { amount, sourceBillNumber, exchangeIds }` filled in.
   - Outside the 7-day window (`EXCHANGE_WINDOW_DAYS`, from bill date or delivery) the page asks
     to allow it and logs `Allowed exchange outside the 7-day window: …`. Lines with an
     alteration charge are not exchangeable (`isExchangeEligible`).
2. **Billing screen** (`BillingForm.js`, Finalize / Partial Payment) saves the new bill through
   **`bill_save`** (latest body: `schema/migration_bill_save_drafts.sql`):
   - `computeCreditsApplied(grandTotal, storeCredit, exchangeAmt)` splits the total: store credit
     first, then `exchange_credit_used = min(credit, rest)`, `effectiveTotal` = what is still to pay.
     The ₹100 payment check and the balance discount (`computeBalanceAdjustedTotals`) run against
     `effectiveTotal`, not the gross total.
   - Bill row: `exchange_credit_used`, `exchange_source_bill` (the source bill number),
     `exchange_cash_refund` (finalize only). Payload: `exchange_ids`,
     `exchange_balance_to_credit` (finalize only).
   - Credit above the new bill (`computeExchangeBalance` > 0): staff must choose **store credit**
     (`exchange_balance_to_credit`, needs a customer) or **cash refund** (`exchange_cash_refund`).
   - `bill_save` links the exchanges (`new_billid` = new bill) under lock and refuses: an
     exchange already linked (`BILL_EXCHANGE_USED`), one belonging to another customer
     (`BILL_EXCHANGE_CUSTOMER`), and `used + balance_to_credit + cash_refund > exchanges' credit`
     (`BILL_EXCHANGE_OVER`). Partial bills take `exchange_ids` too (no balance/cash-refund).
   - Credit recorded earlier and never spent shows on the bill screen as "Apply exchange credit"
     (customer's `exchanges` with `new_billid is null`); that path sends no `exchange_source_bill`.

**Owner rule "exchange credit is NEVER cashed twice"** is already enforced in the database by the
three layers above: `exchange_record` (line cap + held cap + qty already returned), `bill_save`
(unspent-only link, customer, used+refund+credit ≤ credit) and `bill_cancel`
(`schema/migration_bill_cancel_exchange_payout.sql`: refunds received less credit given; a
cancelled new bill puts its exchanges back to unspent). The CLI must only ever go through those
RPCs and must pre-check the same rules in the preview so a refusal shows before anything is written.

**Partial return of a multi-line bill**: supported. Any subset of lines, any integer quantity up
to what is left per line (earlier returns counted).

**What turned out NOT true / gotchas**

- Not one transaction. The app's exchange is two separate transactions (`exchange_record`, then
  `bill_save`). If the bill save fails, the exchange stays recorded: stock is back and the credit
  is unspent, usable later. Doing both atomically would need a new RPC (migration) — not done; the
  CLI follows the app's two-step path and tells the user how to finish (see spec).
- **Returned manual items are never restocked by the app.** ExchangePage sends
  `manual_item_id: ri.manual_item_id`, but `bill_items` has no such column (it selects
  `product_code`, which holds the BCX id), so it is always null and `exchange_record` skips the
  manual-item restock. Later found NOT to be a bug (section 5): a sale never takes manual-item
  stock, so there is nothing to put back.
- `exchanges.returndate` defaults to now and `exchange_record` took no date, so a slip entered
  late got today's return date. Fixed by a migration, not yet applied (section 5).
- `exchange_record` restocks even when the source bill was saved with "don't reduce stock"
  (`stock_reduced = false`); the preview warns then.
- `exchanges.quantity` is an integer: meter quantities cannot be returned in part. (2026-11-22:
  a fractional line can now be returned whole, tasks/fabric-return-plan.md.)
- `exchangeHelpers.js` imported `./billUtils` without `.js`, so Node ESM (the CLI) could not load
  it; changed to `./billUtils.js` as `stockHelpers.js` already does.
- The CLI bills module said "Out of scope: … exchanges"; `bill_save` already accepts every field
  needed, so **no migration and no new RPC are needed**.

## 2. Spec

New optional top-level `exchange` block in the bill spec. Exactly one of two forms:

```json
{
  "customerid": 453,
  "date": "2026-11-14",
  "notes": "Paper bill 999; GPay 1250 + Cash 1000",
  "payment": { "method": "Mixed", "amount": 2250 },
  "exchange": {
    "bill": "FY26-000123",
    "items": [{ "product": "BC26001", "size": "M|38", "color": "Black", "qty": 1, "reason": "size" }]
  },
  "items": [{ "manual_item": { "create": { "name": "3Pc Suit", "category": "S3P", "mrp": 7995, "cost": "ZCHEZ", "size": "38", "color": "Black" } }, "qty": 1, "amount": 5000 }]
}
```

- `exchange.bill` (required in this form): source bill number. `exchange.items[]`: a returned
  line, by `product` (+ `size`, `color`, matched case-insensitively against the source line's
  variant / manual item) or by `bill_item_id`; `qty` (integer > 0, required); `reason` optional.
- Other form: `"exchange": { "exchange_ids": [77, 78] }` spends credit already recorded and not
  yet spent (Exchange page, or a `bill create` whose bill save failed after recording). Nothing is
  returned or restocked again.
- `exchange.balance`: `"store_credit"` or `"cash_refund"`, required exactly when the credit is
  more than the new bill's total, refused otherwise.
- `payment` may be left out (or `amount: 0`, no method) when the credit covers the whole bill.
- Not with `"draft": true` (out of scope: a draft does not spend credit until it is finished).

Credit is never given in the spec: it is computed as the app computes it (`calcItemCredit`).

**Validation in `bill preview` (read-only), each an input error (exit 2) before anything is
written:**

- source bill not found; not `finalized` (app message for `EXCHANGE_BILL_NOT_FINAL`); online
  order not delivered; new bill's customer not the source bill's customer.
- returned line not on the source bill (lists the bill's lines); ambiguous product ref (lists
  matching lines with `bill_item_id`); same line twice; line with an alteration charge.
- qty above what is left: says how many were already returned and, for each earlier exchange of
  the line, its id, credit and whether it is spent (bill number) or unspent (then: use
  `"exchange": {"exchange_ids": [...]}`).
- bill's total exchange credit would exceed what the shop holds for it (app message for
  `EXCHANGE_OVER_HELD`).
- `exchange_ids`: unknown id, already spent (bill number), another customer's credit.
- credit > new total with no `balance`; `balance` given when there is no excess; `store_credit`
  with no customer.
- payment: the ₹100 check is against what is left to pay after the credit; nothing paid while
  something is left (and no `balance_due`) is refused.
- Warnings: exchange date more than 7 days after the source bill (or delivery) — the app asks
  to allow it, the CLI logs the same activity entry on create; source bill saved with
  "don't reduce stock"; returned manual item not restocked.

**Preview output** adds `exchange`: `source_bill`, `returned` (per line: `bill_item_id`, `code`,
`name`, `size`, `color`, `qty`, `credit`, `stock` `{variantid, stock_before, stock_after}` or
`null` for a manual item), `exchange_ids` (ids form), `credit`, `credit_used`, `balance`,
`balance_to` (`store_credit` / `cash_refund` / `null`). `totals` adds `exchange_credit`,
`net_due` (= what is paid + balance due). `bill` carries `exchange_credit_used`,
`exchange_source_bill`, `exchange_cash_refund` as the screen sends them. New-bill stock checks
count returned units of the same variant as back on the shelf.

**`bill create`**: customer/manual items first (as now), then `exchange_record` (activity entry as
the Exchange page writes it, `(via CLI)`; plus the out-of-window entry when warned), then
`bill_save` with `exchange_ids` and, for an excess, `exchange_balance_to_credit` or
`exchange_cash_refund`. If `bill_save` fails after the exchange was recorded, the error ends with
the exchange ids and the exact `"exchange": {"exchange_ids": [...]}` to re-run with (the credit
is unspent, stock is already back). Output adds `exchange` (ids, credit).

**`slip finish` check** (`checkBillAgainstSpec`): expected total = paid + balance due + the
bill's `exchange_credit_used`; mismatch if the bill has no exchange credit when the spec has an
exchange, or `exchange_source_bill` differs from `exchange.bill`.

**Out of scope**: return receipt PDF (the Exchange page prints one); store credit / vouchers /
discount codes (still unsupported); returns with no new purchase (a pure return is the Exchange
page alone); returned manual-item restock (not a bug, section 5); online-order-specific return checks are left to `exchange_record`
(it refuses at create, before the bill is written).

## 3. Plan

- [x] Research, findings above.
- [x] `exchangeHelpers.js`: import `./billUtils.js` (Node ESM).
- [x] `src/admin/lib/exchanges.js`: `parseExchange` (shape), `planExchange` (reads source bill,
      lines, size/colour, earlier exchanges, order, stock; or the `exchange_ids` rows), and
      `recordExchange` (RPC + activity log + error messages).
- [x] `bills.js`: `exchange` key in `parseBillSpec`; payment optional with an exchange;
      `prepareBill` applies credit via `computeCreditsApplied` / `computeExchangeBalance`;
      `createBill` records then saves; `checkBillAgainstSpec` counts credit.
- [x] ~~`fakeSupabase.js`: `.is()` filter~~ not needed (no `.is()` query in the lib).
- [x] Tests: `src/admin/lib/__tests__/exchanges.test.js` (44 tests).
- [x] Docs: `docs/admin-cli.md` Exchanges section.
- [ ] **At merge** (the skill is gitignored and live; changing it before the CLI on main supports
      exchanges would send slip sessions to a refused field): in
      `.claude/skills/reading-bill-slips/SKILL.md`, replace "Exchange or return → not supported;
      move the slip to manual entry." with: "Exchange (goods returned from an earlier bill + a new
      purchase): add `"exchange": { "bill": "<FY26-000NNN the goods were bought on>", "items": [{
      "product", "size", "color", "qty" }] }` (find the bill with `bill find --customer <id>
      --product <code>`); `payment.amount` = what was paid on top of the credit; credit above the
      new bill needs `"balance": "store_credit"` or `"cash_refund"` (ask the owner). A preview
      error saying the line was already returned with credit not spent → use `"exchange":
      {"exchange_ids": [...]}` instead; already spent → the slip is already entered, skip it.
      Pure return with no new purchase → not supported; move the slip to manual entry
      (docs/admin-cli.md#exchanges)."
- [x] Verify (2026-11-22): full app suite 190 suites / 2029 tests pass, `node --test` 11/11.
      Live read-only checks below.

## 4. Results (2026-11-22)

Placeholders: `<source bill>` = the bill the goods were bought on, `<app bill>` = the new bill
staff entered in the app, `<customer>` = their customer id.

- **The triggering slip was already entered in the app** while this was built: one exchange
  (credit 2750, the returned variant's stock 0 → 1) spent on `<app bill>`. The live
  `bill preview` of the slip's spec is therefore refused, correctly: "… was bought 1, 1 already
  returned, so at most 0 can be returned now (exchange N: 1 returned, credit ₹2,750, spent on
  bill `<app bill>`)". Spending that exchange again by `exchange_ids` is refused too.
- What-if preview (read-only, that exchange hidden from the reads) gives exactly the app's
  `<app bill>`: total 5000, discount 2995, `exchange_credit_used` 2750,
  `exchange_source_bill` `<source bill>`, `exchange_cash_refund` 0, `payment_amount` 2250 (Mixed),
  and an `exchange_record` call identical to the app's exchange row (same line, qty 1, credit
  2750, `<customer>`, same name/code snapshot).
- `checkBillAgainstSpec` of the slip's spec against the saved `<app bill>`: ok, no mismatches.

## 5. Follow-ups (owner asked to fix both, 2026-11-22)

### Returned manual items "never restock" — not a bug; left as is

Checked live (read-only, 2026-11-22): `manual_items.stock` is `int4 NOT NULL DEFAULT 1`, and
`bill_items` links to a manual item only by `product_code` = `manual_item_id` (no column, no
foreign key; `BillingForm` and `ExchangePage` both join it that way). No sale path ever lowers
manual-item stock (`bill_save`, `bill_edit`, `bill_cancel` never touch `manual_items`), and the
data shows it: all 190 manual items have stock 1 — 176 sold, 14 not. So a sold manual item still
reads stock 1, and the Exchange page's always-null `manual_item_id` is what keeps a return from
making it 2. Sending the BCX id (the "fix") would count every returned piece twice.

Real manual-item stock tracking would need: `bill_save` / `bill_edit` taking stock for manual
lines, `bill_cancel` and `exchange_record` giving it back, the online paths likewise, and a
backfill setting the 176 sold items to 0 — a migration across the core bill RPCs. Not done;
owner decision. The CLI warning and docs now say why the stock is left alone.

### Return date — done, migration not applied

`schema/migration_exchange_record_return_date.sql` adds `p_returndate timestamp default null`
to `exchange_record` (null = the time of the call, as before; a day before the sale or after
today in India is refused, `EXCHANGE_BAD_DATE`), drops the old three-argument signature in the
same transaction, and keeps security definer and grants. `schema/test_exchange_record_return_date.sql`
(12 checks) fails before it and passes after it on the local test DB
(`scripts/test-db.sh`); `schema/test_bill_exchange_lines.sql` (three-argument calls, as the
Exchange page) passes 48/48 before and after.

- Before the owner runs it: the Exchange page works as today; `bill preview` with an exchange
  works; `bill create` / `slip finish` with an exchange are refused at `exchange_record`
  (PGRST202 → "the owner must run schema/migration_exchange_record_return_date.sql first"),
  before the exchange or the bill is written. Bills without an exchange are unaffected.
- After: the Exchange page is unchanged (no date field; its exchanges are dated when entered);
  the CLI dates the exchange at the slip date, 12:00.
