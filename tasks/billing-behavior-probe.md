# Billing behavior probe — results against current code

Run: `CI=true npx react-scripts test --watchAll=false --testMatch="**/probes/**/*.probe.js"`
Source: `src/admin/components/billing/probes/behaviorProbe.probe.js` (kept out of the default
test run on purpose — it is expected to be red until the refactor lands).

Result: **12 of 27 assertions fail.** Each behavior below is phrased the way the shop owner
would state it, with no reference to code.

## Scenario A — the workhorse bill

Invoice, code `SAVE10` (10%), two items:
- Lehenga, stitched, MRP ₹2,800 × 1
- Saree, unstitched, MRP ₹1,200 × 1, alteration ₹210

| Path | Grand total | Line amounts |
|---|---|---|
| On screen (`computeBillTotals`) | 4,296.60 | — |
| Stored (`bill_items`) | 4,296.60 | 2,973.60 / 1,323.00 |
| Printed (`InvoiceView`, rendered) | 4,296.60 | 2,974.38 / 1,322.30 |

## Scenario B — same bill as a Bill of Supply

| Path | Grand total | Line amounts |
|---|---|---|
| On screen | 3,790.00 | — |
| Stored | **3,810.00** | 2,520.00 / 1,290.00 |
| Printed | 3,790.00 | 2,520.67 / 1,269.33 |

## Verdict per behavior

| # | Behavior | Result | Evidence |
|---|---|---|---|
| B1 | Printed line amounts add up to the printed total | **FAIL** (invoice) / PASS (BoS) | lines sum 4,296.68 vs total 4,296.60 — off ₹0.08 |
| B2 | Stored lines add up to the stored bill total | PASS (invoice) / **FAIL** (BoS) / **FAIL** (voucher) | BoS 3,810 vs 3,790 = **₹20**; voucher 4,774 vs 3,885 = **₹889** |
| B3 | Printed line amount == stored line amount | **FAIL** both | invoice ₹0.78 & ₹0.70 out; BoS ₹0.67 & **₹20.67** out |
| B4 | Printed GST% == stored GST% | PASS | both 18 / 5 |
| B5 | On-screen GST% == stored GST% | PASS here, **FAIL** at a slab crossing → B15 | |
| B6 | Alteration is never discounted | PASS (invoice subtotal) / **FAIL** (BoS printed vs stored) | printed discounts the alteration, ledger does not |
| B7 | Reprinting a finalized bill shows the total the customer paid | **FAIL** | with a code: **3,572.06 vs 4,296.60 (−₹724.54)**; ₹5-rounded bill: 4,770.05 vs 4,770.00 |
| B8 | ₹5 round-down lands on an exact multiple of ₹5 | PASS | |
| B9 | "Customer pays exactly ₹X" makes the total exactly ₹X | PASS | binary search is accurate |
| B10 | Shown total discount == sum of stored per-line discounts | PASS | 420 = 280 + 140 |
| B11 | CGST == SGST and together they equal the GST total | **FAIL** | printed 516.68 vs computed 516.60 |
| B12 | A Bill of Supply never charges GST | PASS | `gst_total` 0, every line `gst_amount` 0 |
| B13 | WhatsApp total == PDF total | PASS | |
| B14 | WhatsApp item lines add up to the WhatsApp total | **FAIL** | lines sum 4,210 vs its own total 4,296.60 |
| B15 | A discount that drops a stitched item under ₹2,500/piece shows the operator the GST% the bill will carry | **FAIL** (screen) / PASS (print) | ₹2,700 −10% → ₹2,430: screen shows **18%**, bill stores and prints **5%** |
| B16 | A "GST Off" code on a Bill of Supply gives away nothing, since no GST was charged | **FAIL** | 4,210 → **3,636**: ₹574 off for tax never charged |

## Root causes (all four already named in the refactor plan)

- **B1, B3, B11 (invoice, paisa-scale):** `InvoiceView.js:110,116` derives goods taxable as
  `adjustedTaxable − fullAlteration`; `stockHelpers.js:88-91` splits proportionally by `alterProp`.
  Two different alteration treatments → different taxable, GST, and line totals.
- **B2, B3, B6 (BoS, ₹20-scale):** the stored BoS line re-adds the **full** alteration
  (`stockHelpers.js:113`) while `computeBillTotals` discounted it (`billUtils.js:102,141`).
  The ₹20 is exactly the alteration's share of the ₹420 code discount: `140 × 200/1400`.
- **B2 (voucher, ₹889):** `buildBillItemsPayload` has no voucher parameter, so the voucher
  reduces the bill total but never the lines.
- **B7 (₹724):** `BillTable.js:98` back-calculates `quickDiscountPct` from `discount_total`
  (which already contains the code-discount share), then `:162` applies the code again.
- **B14:** `generateBillText.js:51` prints face value per line and a fully-discounted total.
- **B15:** `priceItem` picks the slab on the pre-allocation price, `computeBillTotals` and
  `buildBillItemsPayload` on the post-allocation price.
- **B16:** `valueOfDiscount`'s `gst_off` branch sums `priceItem(...).gst_amount`, which is
  computed regardless of `docType` — phantom GST on a document that charges none.

## Live-data incidence (queried 2026-08-20)

| Fact | Value |
|---|---|
| Bills total | 273 |
| Bills with `document_type = 'invoice'` | **0** — every bill ever issued is a Bill of Supply |
| Bills with a discount code | 30 |
| Bills with any alteration charge | 21 |
| Bills with **both** a code and an alteration | **0** |
| Bills where `SUM(bill_items.total) ≠ bills.totalamount` | **1** of 272 (worst ₹34.38) |
| Vouchers ever issued | 0 (table empty) |

The single mismatched bill is **FY26-000238** (`billid` 255): `totalamount` 3,100 (a balance
waiver down to the ₹3,100 paid), line sum 3,134.38, ₹190 of alteration, no codes. Delta ₹34.38
is the B2/B6 class — the waiver discounted the alteration in the total but not in the stored lines.

Two things follow:

1. **The divergences are real but have barely fired**, because a code discount and an alteration
   charge have never co-occurred on one bill. The exposure is the *waiver* path (which acts as a
   bill-level discount and does co-occur with alterations), and it has cost ₹34.38 of ledger
   inconsistency across 272 bills.
2. **The invoice path has never been used.** The decision to keep both doc types first-class
   (plan §2.3) is therefore forward-looking, not a description of today's traffic. Every
   invoice-path failure above (B1, B3, B11, B15) is currently theoretical; the BoS ones
   (B2, B3, B6, B16) and the reprint one (B7, which applies to all 273 bills) are live.

## Behaviors the current code gets right

Worth stating, because the refactor must not lose them: the ₹5 round-down lands exactly on a
multiple of ₹5 (B8), a forced final amount is hit to the paisa (B9) — both via the binary search
in `computePreTaxBalanceDiscount`, which is genuinely handling the non-linearity that slab
transitions introduce — the per-line stored discounts reconcile to the shown total (B10),
BoS carries no GST (B12), and the WhatsApp and PDF totals agree (B13).

## Open question for the owner

**B16 — should a `gst_off` code do anything on a Bill of Supply?** Right now it takes ₹574 off
Scenario B, calculated as the GST that would have applied had the bill been a tax invoice. If
that is deliberate pricing ("we pay the GST" as a ~13.6% promotion) it should be re-expressed as
a percentage discount, because the current amount silently depends on each item's stitched/
unstitched mix and slab position. If it is not deliberate, `gst_off` should evaluate to zero on
a BoS. This is the only probe failure that is a pricing-policy question rather than a defect.
