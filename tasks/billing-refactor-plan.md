# Billing Refactor Plan — single source of truth for bill totals

Status: PLAN ONLY (no code changed). Written 2026-08-20. Decisions recorded §2.

## 1. Current state (verified by reading the code)

Files in play:

| File | Lines | Role today |
|---|---|---|
| `src/admin/components/billing/billUtils.js` | 295 | intended source of truth: `priceItem`, `computeBillTotals`, `computePreTaxBalanceDiscount`, discount valuation |
| `src/admin/components/billing/stockHelpers.js` | 152 | `buildBillItemsPayload` — what gets **persisted** to `bill_items` |
| `src/admin/components/billing/InvoiceView.js` | 669 | what gets **printed** (PDF/invoice) — has its own per-line math |
| `src/admin/components/billing/generateBillText.js` | 108 | WhatsApp text — third per-line math |
| `src/admin/components/billing/Summary.js` | 235 | on-screen totals |
| `src/admin/components/billing/ItemRow.js` | 188 | on-screen per-line totals — own BoS variant |
| `src/admin/components/billing/BillingForm.js` | 2612 | orchestration + 6 near-duplicate persistence paths |
| `src/admin/components/BillTable.js` | ~1100 | **reprint** path — recomputes totals from DB |
| `src/admin/components/billing/exchangeHelpers.js` | 76 | `computeCreditsApplied` (store/exchange credit split) |

### 1.1 Four independent implementations of the same line math

The same "MRP × qty − item disc + alteration → allocate bill-level discounts → decide GST slab → CGST/SGST → line total" pipeline is written **four times**:

1. `billUtils.priceItem` + `computeBillTotals` (`billUtils.js:25`, `:87`)
2. `stockHelpers.buildBillItemsPayload` (`stockHelpers.js:50`)
3. `InvoiceView.js:69-136` (`lineItems`) — rebuilds from raw `item.mrp/qty/quickDiscountPct`, never calls `priceItem`
4. `generateBillText.js:45-59` (`itemLines`)

Known divergences between them:

- **Alteration split.** `buildBillItemsPayload:88-91` splits the post-discount subtotal into goods/alteration *proportionally* (`alterProp`). `InvoiceView.js:110,116` instead does `garmentTaxable = adjustedTaxable - alteration` using the **full entered** alteration. Different goods taxable → different slab decision → different CGST/SGST on the same bill.
- **BoS line amount.** persisted `bosTotal = adjustedItemPreTax + alterFull` (`stockHelpers.js:113`, alteration *not* discounted) vs printed `bosAmount = adjustedTaxable` (`InvoiceView.js:134`, alteration *is* discounted) vs `ItemRow.js:24-26` third variant.
- **Slab input.** `priceItem` decides the slab on `afterDisc/qty` (before bill-level discounts); `computeBillTotals:125` and `buildBillItemsPayload:102` decide it on the post-allocation price. So the GST% the operator sees in `ItemRow` (`pricing.gstRate`, `ItemRow.js:137`) can differ from the GST% printed and stored.
- **Rounding-discount allocation is duplicated verbatim** — the "whole rupees, last line absorbs the remainder" rule lives in both `stockHelpers.js:66-82` and `InvoiceView.js:86-96` ("mirrors buildBillItemsPayload" per its own comment). Two copies of a rule that must agree exactly.
- `generateBillText` line total ignores discounts, GST, and BoS entirely.

### 1.2 Voucher is never distributed into `bill_items`

`buildBillItemsPayload` has no voucher parameter (`stockHelpers.js:50`) and no call site passes one. But `computeBillTotals` subtracts `voucherPreTax` from `taxableTotal` (`billUtils.js:102`) and `InvoiceView.js:97-101` *does* distribute it per line. So on a voucher bill, `SUM(bill_items.total) > bills.totalamount` and printed lines ≠ stored lines.

**Verified 2026-08-20: the `vouchers` table is empty — zero rows, no voucher has ever been issued or redeemed.** So this has never fired in production and there is no historical data to reconcile. Combined with the decision to make vouchers a post-tax tender (§2.2), this divergence disappears rather than needing a fix: nothing pre-tax remains to allocate.

### 1.3 Reprint recomputes and double-counts (bug — real, affects live bills)

`BillTable.js:88-103` rebuilds items from `bill_items`, deriving `quickDiscountPct` via `backCalcDiscountPct(bi.discount_total, ...)`. But `discount_total` stored per line is `itemDisc + overallShare + balanceShare + roundingShare` (`stockHelpers.js:125`). So all bill-level discounts get folded back in as if they were item discounts — then `BillTable.js:162` calls `computeBillTotals(items, appliedCodes, allDiscounts, 0, 0, docType)`, which **re-applies the code discounts on top**.

Consequence: a reprinted PDF can show a different grand total than the one the customer paid and than `bills.totalamount`.

### 1.4 `bills.discount_total` written three different ways

Six write sites in `BillingForm.js` (846, 1012, 1275, 1414, 1657, 1751 for items; 872, 992, 1236, 1392, 1626, 1730 for the bills row) with at least three formulas:
- `itemLevel + overall + (isAutoRounded ? balance : 0)` (`:874`)
- `itemLevel + overall + balance` (`:1237`, `:1628`)

### 1.5 Credit split re-implemented inline

`exchangeHelpers.computeCreditsApplied` is the declared single source of truth, yet the same `Math.min` chain is hand-rolled in `BillingForm.js:2463-2499` (finalize dialog), `:2575-2582`, and `generateBillText.js:39-43`.

### 1.6 Two money formatters

`billUtils.money` rounds to whole rupees (`billUtils.js:7`); `utility/formatCurrency.formatINR` renders 2 decimals. `Summary`/`ItemRow` use the first, `InvoiceView`/`generateBillText`/`ReturnReceiptView` use the second. Same bill shows ₹4,321 on screen and ₹4,320.50 on paper.

### 1.7 Other

- `BillingForm.js` has six ~150-250 line persistence blocks (draft-new, draft-edit, finalize-new, finalize-edit, partial-new, partial-edit) that duplicate: stock validation → bills insert/update → delete+rebuild `bill_items` → salesperson reconcile → stock deltas → PDF generation → activity log.
- Debug `console.log` left in production path: `stockHelpers.js:97-98`.
- Two chained memos (`autoRoundedComputed`, `balanceAdjustedComputed`, `BillingForm.js:575-649`) encode a 3-state machine as a boolean flag `isAutoRounded` that then leaks into 8 downstream branches.
- `ItemRow.js:136-150` renders a GST% dropdown that the engine unconditionally overrides — dead UI.

---

## 2. Decisions (owner, 2026-08-20)

### 2.1 Alteration is protected from every bill-level discount, on both doc types
Item-level `quickDiscountPct` already only touches goods (`itemDisc = mrp × qty × pct`). Bill-level reductions — code discounts, voucher, ₹5 rounding, balance waiver — now behave the same way: they allocate across **goods value only**. Alteration keeps its full quoted value and, on invoices, its own 5% GST.

Rationale: alteration is a service already rendered at a quoted price. Matches what `bill_items` already stores for BoS (`stockHelpers.js:113`). One rule for both doc types → one allocation path in the engine, no `alterProp`.

Consequences:
- The proportional `alterProp` split (`stockHelpers.js:88-91`) is deleted.
- On invoices with alteration + a bill-level discount, the goods taxable drops further than today, so stitched items cross the ₹2500 slab boundary slightly sooner. Future bills only — no backfill (§5.3).
- `InvoiceView`'s BoS line amount changes to match the ledger.

### 2.2 Voucher is a post-tax tender, not a pre-tax discount
Voucher stops reducing GST. It joins store credit and exchange credit below the grand total.

**Tender order: store credit → exchange credit → voucher.** Voucher is fully redeemed regardless of leftover; excess is forfeited (single-use coupon, no change given). Matches `vouchers.redeemed` being a boolean with no partial-use column.

Consequences:
- `voucherPreTax` leaves `computeBillTotals` entirely; `computeCreditsApplied` becomes `applyTenders`.
- `bills.discount_total` no longer includes the voucher.
- Staff-visible warning at the confirm dialog when voucher value exceeds payable, stating the forfeited amount.
- **Zero migration risk: the `vouchers` table is empty (verified).** This is greenfield.

### 2.3 Both `invoice` and `bos` stay first-class
Every fixture, invariant, and snapshot runs for both doc types.

### 2.4 The ₹5 round-down applies at finalize only, both doc types
Drafts show the honest untouched total; rounding is resolved once, at finalize. A draft total can therefore sit up to ₹4 above the finalized total — surfaced in the confirm dialog as an explicit "Rounding" line.

Consequence: the draft-save path stops using `autoRoundedComputed` (`BillingForm.js:845`). The comment there (`:839-844`) was guarding against the *balance-forcing* memo leaking into edits; that concern is preserved — draft saves use the raw totals, which is strictly safer.

### 2.5 GST% dropdown is dropped; rate is derived and read-only
`items.gstRate` stops being an input. `stitchType` + post-allocation goods price per unit decide the rate, in one function. `bill_items.gst_rate` remains a persisted *output*. `ItemRow` shows the derived rate as plain text, so what the operator sees is what gets printed and stored.

### 2.6 Paisa in the data, whole rupees at render
**Nothing about stored or computed precision changes.** The engine works in paisa and `bill_items` / `bills` keep their existing 2-decimal numerics. Rounding is purely a rendering concern, applied at the last step, on both screen and documents. One formatter, 0 decimals, used by Summary, ItemRow, BillTable, PDF, and WhatsApp alike — so screen and paper always agree.

**Footing rule.** Rounding each value independently can make a rendered column miss its rendered total by ₹1–2 on a multi-item bill — unacceptable on a tax document. So the display layer does not round values in isolation; it rounds so that **every arithmetic relationship the reader can see holds exactly**, by designating one slack cell per relationship to absorb the residual:

| Rendered relationship | Slack cell |
|---|---|
| line amounts sum to grand total | last line |
| line taxable / CGST / SGST columns sum to their totals | last line, per column |
| Subtotal − discounts + GST = Total (Summary, PDF totals block) | the GST line |

A slack cell can therefore differ by up to ₹1 from a naive rounding of its own exact value. That is the deliberate trade: the document adds up. Accepted cosmetic consequence: when total GST is an odd rupee, rendered CGST and SGST differ by ₹1.

Exact paisa values remain available for reconciliation via the DB and the `SUM(bill_items.total)` check in §6.

### 2.7 Legacy reprint: trust the stored rows, best-effort breakdown
A finalized bill prints from what was persisted. Money comes from `bill_items` rows and `bills.totalamount` — never re-derived. The discount *breakdown* is reconstructed for display from `applied_codes` and forced to reconcile to the stored total, with any unexplained remainder shown as a single "Other Discount" line. No voucher special case is needed (§1.2 — none exist).

---

## 3. Target architecture

**Rule: exactly one function turns (items, discounts, target-total, docType) into every number any consumer needs. Every other module is a projection of its output.**

```
src/admin/components/billing/pricing/
  engine.js      priceBill(input) -> BillTotals
  allocate.js    allocateOverGoods(lines, reductions) -> per-line shares
  gst.js         slabFor({ stitchType, goodsPerUnit }), splitGst(...)
  target.js      resolveBillTarget(...) -> { preTaxDiscount, mode }
  tenders.js     applyTenders(grandTotal, { storeCredit, exchangeCredit, voucher })
  discounts.js   valueOfDiscount, getFreeItems   (moved unchanged from billUtils)
  rehydrate.js   rehydrateBillTotals(billRow, billItems)
  format.js      money(n)   // 0dp render, one definition
  display.js     forDisplay(totals) -> whole-rupee view, slack cells absorb residuals (§2.6)
  index.js
```

`BillTotals` (the one contract):

```js
{
  docType: 'invoice' | 'bos',
  lines: [{
    itemId, qty, mrp, unitType, productName, /* identity passthrough */
    goodsBase, itemDisc, overallDisc, balanceDisc, roundingDisc, discountTotal,
    goodsTaxable,                       // post-allocation, discountable portion
    alterationGross, alterationPreTax, alterationGst,   // never discounted
    gstRate, cgst, sgst, gstAmount,
    lineTotal,                          // invoice: taxable + gst ; bos: goodsTaxable + alterationGross
    isFree                              // buy_x_get_y label
  }],
  itemsSubtotal, itemLevelDiscountTotal, preOverallTaxable,
  overallDiscount, balanceDiscount, roundingDiscount,
  taxableTotal, gstTotal, cgstTotal, sgstTotal, grandTotal,
  discountTotal,          // the ONE number written to bills.discount_total (no voucher)
  target: { mode: 'none' | 'auto_round' | 'balance_waiver', amount },
  display: { lines: [...], totals: {...} }   // render-only whole-rupee view, footing (§2.6)
}
```

Tenders sit outside `BillTotals` — they are payment, not pricing:

```js
applyTenders(grandTotal, { storeCredit, exchangeCredit, voucher })
  -> { storeCreditUsed, exchangeCreditUsed, voucherUsed, voucherForfeited,
       exchangeBalance, payable }
```

Invariants the engine guarantees (asserted in tests):
1. `sum(lines.lineTotal) === grandTotal`
2. `sum(lines.discountTotal) === itemLevelDiscountTotal + overallDiscount + balanceDiscount + roundingDiscount === discountTotal`
3. `sum(lines.cgst + lines.sgst) === gstTotal`, and `cgstTotal === sgstTotal`
4. `docType === 'bos'` ⇒ every `gstAmount === 0`
5. every line's `alterationGross` equals the entered `alteration_charge`, on every code path (§2.1)
6. GST slab decided in exactly one place (`gst.js`), on post-allocation goods price per unit
7. every rendered relationship in `display` holds exactly — line columns sum to their totals, and Subtotal − discounts + GST = Total (§2.6). Asserted on integers, so a regression is a hard failure, not a rounding smell.
   Also: `display` never feeds back into `lines`/totals — exact values are what get persisted.
8. `rehydrateBillTotals(persist(t))` reproduces `t.grandTotal`, `t.gstTotal`, `t.discountTotal`, and every line's `lineTotal`

Consumers after the refactor:

| Consumer | Becomes |
|---|---|
| `buildBillItemsPayload` | `totals.lines.map(toBillItemRow)` — no arithmetic |
| `InvoiceView` | renders `totals.display` — no arithmetic |
| `generateBillText` | renders `totals.display` — no arithmetic |
| `Summary` | renders `totals` + `applyTenders` result — no arithmetic |
| `ItemRow` | renders `totals.lines[i]`, GST% as read-only text (§2.5) |
| `BillTable` reprint | `rehydrateBillTotals(billRow, billItems)` |
| finalize dialogs | `applyTenders` only |

`isAutoRounded` boolean → `target.mode` enum.

---

## 4. Scope

In scope: `billUtils.js`, `stockHelpers.js`, `InvoiceView.js`, `generateBillText.js`, `Summary.js`, `ItemRow.js`, `ItemTable.js`, `BillingForm.js`, `BillTable.js` reprint path, `exchangeHelpers.js`.

Out of scope: storefront cart/checkout (`src/storefront/**` — different domain, no GST), `utility/supplierBillCalc.js` (purchase side), `ExchangePage`/`ReturnReceiptView` credit math beyond adopting the shared formatter, `exchanges` schema.

---

## 5. Phases

### Phase 0 — Freeze current behavior (no production code changes)
0. **Already started:** `src/admin/components/billing/probes/behaviorProbe.probe.js` states 16 behaviors in owner language and runs them against all four current paths. 12 of 27 assertions fail today; results and root causes in `tasks/billing-behavior-probe.md`. It stays out of the default test run (`--testMatch="**/probes/**/*.probe.js"`) until the refactor turns it green, at which point it becomes the acceptance suite. One open pricing-policy question came out of it — `gst_off` on a BoS (§6, item 8).
1. Golden fixtures: 14 bill scenarios × both doc types — plain, item disc only, %-code, `buy_x_get_y`, `fixed_price`, `bundled_pricing`, `gst_off`, `conditional`, ₹5 rounding, balance waiver, alteration-only, alteration + bill-level discount, stitched crossing ₹2500 both directions, meter items, multi-item rounding remainder.
2. Snapshot each fixture through **all four** current paths: `computeBillTotals`, `buildBillItemsPayload`, `InvoiceView` line math (extracted to a test-local copy), `generateBillText`.
3. Commit the snapshots. Every path-to-path divergence gets an entry tagged `KEEP` or `FIX-per-§2`.

Verify: `npm test` green; divergence list reviewed against §2 so nothing changes by accident.

### Phase 1 — Build the engine
4. `gst.js` — slab + CGST/SGST split. Boundary tests: 2499.99 / 2500.00 / 2500.01, unstitched forced 5%, alteration always 5%.
5. `allocate.js` — `allocateOverGoods`: proportional over `goodsBase` only (§2.1), per-reduction rounding policy (round2 for overall/balance, whole-rupee for rounding), last line absorbs remainder, never negative, alteration untouched.
6. `discounts.js` — move `valueOfDiscount`/`getFreeItems` unchanged. Note: their internal `withCharges` basis now means goods-only; assert `gst_off` and `buy_x_get_y` values against the Phase 0 snapshots.
7. `engine.js` — `priceBill`.
8. `target.js` — fold the two `BillingForm` memos into `resolveBillTarget({ totals, finalAmount, paymentAmount, tenders })`, returning `{ preTaxDiscount, mode }`. Keeps the existing binary search (`billUtils.js:74-83`), which is still needed because slab transitions make the total non-linear in the discount. Rounding branch is finalize-only (§2.4). Shortfall is measured against payable-after-tenders.
9. `tenders.js` — `applyTenders` with the §2.2 order and forfeiture.
10. `display.js` — `forDisplay(totals)`: whole-rupee render view with slack-cell residuals (§2.6). Pure function over `BillTotals`, no engine feedback.
11. Invariant tests (§3.1-3.7) across every fixture.

Verify: all invariants hold for all fixtures; engine matches the `KEEP` side of each recorded divergence and the §2 answer for each `FIX`.

### Phase 2 — Move consumers onto the engine (one commit each, snapshot-diffed)
12. `buildBillItemsPayload` → pure mapper. Deletes the duplicated GST/allocation code and both `console.log`s.
13. `InvoiceView` → consume `totals.display`. Deletes ~70 lines of arithmetic, including its copy of the rounding allocation.
14. `generateBillText` → consume `totals.display`.
15. `Summary`, `ItemRow`, `ItemTable` → consume `totals`; `ItemRow` GST% becomes read-only text and the dropdown is removed (§2.5).
16. One render formatter, 0dp (§2.6). `billUtils.money`, `utility/formatCurrency.formatINR`, and the local duplicate at `SupplierLedgerDialog.js:76` are replaced. Billing surfaces render `totals.display`, never raw exact values.
    Non-billing callers of `formatINR` (dashboard, suppliers, customers — ~20 sites) also switch to the shared 0dp `money`. Two of these need a judgement call rather than a blind swap, because they are *inputs*, not outputs: `ProductEditDialog.js:363,420` and `CustomerForm.js:476` format values inside form fields — rounding a field the user then submits would silently truncate stored precision. Those keep exact rendering.
    `SupplierLedgerDialog`/`SupplierTransactionsTab` show a running ledger balance; apply the same slack-cell rule so the running column still foots, or leave supplier surfaces at 2dp and note it as an accepted inconsistency outside the billing domain. Decide when Phase 2 reaches them — it does not block the engine.
17. Inline credit math (`BillingForm.js:2463-2499`, `:2575-2582`, `generateBillText.js:39-43`) → `applyTenders`.

Verify per commit: snapshots unchanged except the deliberate `FIX` lines; `npm test`; manual smoke = one bill with alteration + code discount + rounding + a stitched item near ₹2500, checked across Summary, ItemRow, PDF, WhatsApp, and `bill_items`.

### Phase 3 — Voucher as tender + persist/rehydrate (fixes §1.3)
18. Migration `schema/migration_bill_reductions.sql` (confirm live column names first per `CLAUDE.md`): add to `bills` — `voucher_used numeric default 0`, `balance_discount numeric default 0`, `rounding_discount numeric default 0`, `target_mode text`. No backfill.
19. Voucher moves out of pricing into tenders (§2.2): `computeBillTotals` loses `voucherPreTax`; `Summary`/`InvoiceView` render it below the grand total; `net_amount` = payable after all three tenders; forfeiture warning in the confirm dialog.
20. Write the new columns on every finalize path; `bills.discount_total` becomes `totals.discountTotal` — one formula, all six sites.
21. `rehydrateBillTotals(billRow, billItems)` — money from stored rows, breakdown best-effort and forced to reconcile (§2.7). `BillTable` reprint switches to it. `backCalcDiscountPct` survives only for loading a *draft* into the editor.
22. Tests: round-trip `rehydrate(persist(fixture))` for all fixtures; regression test that reprinting a bill with a code discount reproduces the stored `totalamount` (fails today).

Verify: round-trip green; reprint 3 real finalized bills (one with a code discount, one rounded, one BoS) and diff PDF totals against `bills.totalamount`.

### Phase 4 — Collapse `BillingForm` persistence
23. Extract `src/admin/services/billing.js`: `saveBill({ mode: 'draft'|'finalize'|'partial', isNew, billId, items, totals, tenders, meta })` — one path: validate stock → upsert `bills` → rebuild `bill_items` → reconcile salespersons → apply stock deltas → return `{ billId, billNumber }`. PDF, toasts, and activity log stay in the component (side effects at the edge).
24. Replace the six blocks with `saveBill` calls. Target: `BillingForm.js` under ~1200 lines.
25. Service tests against a mocked Supabase client: each mode, insert-failure rollback (`BillingForm.js:1287` deletes the orphan bill), backdated skips stock deltas.

Verify: `npm test`; manual pass over all six flows plus add-payment.

### Phase 5 — Cleanup
26. Delete `billUtils.js` (all seven importers migrated: `BillTable`, `InvoiceView`, `ItemRow`, `Summary`, `stockHelpers`, `exchangeHelpers`, `PaymentHistory`).
27. ADR `docs/adr/billing-pricing-engine.md`: the one-engine rule, reprint-never-recomputes, alteration-is-protected, voucher-is-tender, allocation/rounding policy, 0dp display with residual footing.
28. Update `CLAUDE.md` billing notes.

---

## 6. Behavior changes to expect

Money on a document changes in these cases. None require a data migration; none touch historical rows.

1. **Reprints stop double-counting code discounts** (§1.3) — reprint now equals what the customer paid. PDFs already sent out won't match new reprints of the same bill. This is the one change affecting existing bills.
2. **Invoice + alteration + bill-level discount** (§2.1) — goods absorb the whole discount instead of a proportional share, so goods taxable is lower and a stitched item near ₹2500 can land in the 5% slab where it previously sat at 18%. Future bills only.
3. **BoS printed line amount** aligns with the stored ledger value (alteration no longer discounted on the printout).
4. **`ItemRow` GST%** now shows the rate that is actually printed and stored, and stops being editable.
5. **Draft totals are no longer ₹5-rounded** (§2.4) — a draft reads up to ₹4 higher than the bill it becomes.
6. **All amounts render as whole rupees** (§2.6), documents included — stored precision unchanged, so this is reversible by swapping one formatter.
7. **Vouchers stop reducing GST** (§2.2) — no historical impact, the table is empty.
8. **`gst_off` on a Bill of Supply** — needs an owner decision, not a refactor. Today it discounts by the GST that *would* have applied (₹574 on the probe's scenario), computed from phantom tax on a document that charges none, so the amount silently varies with each item's stitched/unstitched mix and slab position. Either re-express it as a plain percentage discount, or make it evaluate to zero when `docType === 'bos'`. Until decided, the engine preserves current behavior.

**Measured incidence** (probe run 2026-08-20, see `tasks/billing-behavior-probe.md`): 273 bills, all `document_type = 'bos'` — the invoice path has never been used, so §2.3 is forward-looking. 30 bills carry a code, 21 carry an alteration, **0 carry both**, which is why the alteration divergences have barely fired. Exactly **1 bill of 272** has `SUM(bill_items.total) ≠ bills.totalamount` (FY26-000238, ₹34.38, a balance-waiver bill with alteration). Change #1 (reprint) is the only one affecting all 273. Vouchers: none ever issued.

The one-off check, for re-running after Phase 3:

```sql
SELECT bi.billid, SUM(bi.total) AS line_sum, b.totalamount
FROM bill_items bi JOIN bills b USING (billid)
GROUP BY bi.billid, b.totalamount
HAVING ABS(SUM(bi.total) - b.totalamount) > 0.5;
```

## 7. Sequencing

Phases 0-2 change no stored value and can ship independently, in order. Phase 3 carries change #1 above and the schema migration. Phase 4 is independent of Phase 3 — reorder it earlier if `BillingForm`'s size is the more urgent pain.
