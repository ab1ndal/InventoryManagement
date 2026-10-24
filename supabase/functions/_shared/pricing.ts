/**
 * Online-order pricing. Pure: no I/O, the shipping rate is an input.
 *
 * Money crosses this module's boundary in rupees (numbers with at most 2 dp)
 * and is computed internally in integer paise, so every split sums exactly.
 *
 * Order of application (spec §7, plan Task 2 + R7):
 *   promo → shipping → voucher → store credit.
 *   1. promoDiscount on the subtotal, shared over lines by line value.
 *   2. shipping: free if subtotal − promo ≥ ₹5,000, else rate rounded up to
 *      the next ₹10, else flat ₹99 when there is no rate.
 *   3. voucherApplied = min(voucher value, amount due).
 *   4. creditApplied = min(requested, available, due − voucher).
 *   5. R7: if 0 < gateway < ₹1 and some voucher/credit was applied, credit is
 *      reduced first, then voucher, so the gateway charge is exactly ₹1.00.
 *
 * Naming: "nonGateway" = voucher + store credit together. Both are refunded
 * as credit (store credit for registered shoppers, a new voucher for guests),
 * so the per-line split only needs two sources: `nonGatewayPart` and
 * `gatewayPart` (there is no separate per-line credit/voucher split).
 *
 * Deterministic split rule (spec §7 leaves it to the builder): non-gateway
 * money covers goods before shipping. nonGatewayGoods = min(nonGateway,
 * goods); the rest of it covers shipping (`shippingNonGateway`). Each line's
 * nonGatewayPart = allocate(nonGatewayGoods, paidValues). Because every part
 * is ≤ its line's paid value and per-unit refunds come from the same parts,
 * Σ refunds never exceed what was paid per source.
 */

export type Line = {
  itemKey: string;
  variantId: string;
  productId: string;
  name: string;
  size: string;
  color: string;
  category: string | null;
  unitPrice: number;
  qty: number;
};

export type Promo = {
  code: string;
  type: "flat" | "percentage" | "conditional";
  value: number;
  max_discount: number | null;
  min_total: number | null;
  rules: Record<string, unknown> | null;
};

export type QuotedLine = Line & {
  promoShare: number;
  paidValue: number;
  nonGatewayPart: number;
  gatewayPart: number;
};

export type Quote = {
  lines: QuotedLine[];
  subtotal: number;
  promoDiscount: number;
  shipping: number;
  /** Part of `shipping` covered by voucher/credit (only when goods are fully covered). */
  shippingNonGateway: number;
  shippingGateway: number;
  /** subtotal − promoDiscount + shipping. */
  amountDue: number;
  creditApplied: number;
  voucherApplied: number;
  gatewayAmount: number;
  freeShippingGap: number;
};

export type QuoteInput = {
  lines: Line[];
  promo: Promo | null;
  shippingRate: number | null;
  creditRequested: number;
  creditAvailable: number;
  voucherValue: number;
};

export const FREE_SHIPPING_THRESHOLD = 5000;
export const FLAT_SHIPPING = 99;
/** Cashfree's minimum order amount. */
export const MIN_GATEWAY_AMOUNT = 1;

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const toRupees = (paise: number): number => paise / 100;

/** Same as billUtils.round2. */
function round2(n: number): number {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

/** Same as billUtils.clampMax: null/undefined means no cap; 0 caps at 0. */
function clampMax(v: number, m: number | null | undefined): number {
  if (!m && m !== 0) return v;
  return Math.min(v, Number(m));
}

function assertMoney(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0) {
    throw new RangeError(`${name} must be a finite amount ≥ 0, got ${v}`);
  }
}

/**
 * Promo value in rupees, mirroring billUtils.valueOfDiscount for flat,
 * percentage and conditional. Never more than the subtotal, never negative.
 */
export function promoDiscount(promo: Promo | null, subtotal: number): number {
  if (!promo) return 0;
  const total = subtotal;
  if (Number(promo.min_total || 0) > 0 && total < Number(promo.min_total)) return 0;
  let value: number;
  switch (promo.type) {
    case "flat":
      value = clampMax(Number(promo.value || 0), promo.max_discount);
      break;
    case "percentage":
      value = clampMax(round2((total * Number(promo.value || 0)) / 100), promo.max_discount);
      break;
    case "conditional": {
      const r = promo.rules || {};
      const minTotal = Number(r.min_total || promo.min_total || 0);
      const val = Number(r.value || promo.value || 0);
      value = total >= minTotal ? clampMax(val, promo.max_discount) : 0;
      break;
    }
    default:
      value = 0;
  }
  if (!Number.isFinite(value) || value <= 0) return 0;
  return toRupees(Math.min(toPaise(value), toPaise(subtotal)));
}

/**
 * Shipping in rupees. Free at ₹5,000+ of discounted goods; otherwise the
 * courier rate rounded up to the next ₹10; flat ₹99 when there is no usable
 * rate (null, non-finite or ≤ 0).
 */
export function shippingCharge(rate: number | null, discountedSubtotal: number): number {
  if (toPaise(discountedSubtotal) >= toPaise(FREE_SHIPPING_THRESHOLD)) return 0;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return FLAT_SHIPPING;
  return Math.ceil(toPaise(rate) / 1000) * 10;
}

/**
 * Splits integer `totalPaise` over `weights` in proportion, summing exactly.
 * Each part starts at floor(total × w / Σw); the leftover paise (fewer than
 * the number of non-zero weights) go one each to the largest weights first,
 * ties to the earliest index. So when total ≤ Σweights no part exceeds its
 * weight. Exact BigInt maths, so large orders don't lose precision.
 */
export function allocate(totalPaise: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError(`allocate: total must be a non-negative integer, got ${totalPaise}`);
  }
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`allocate: weights must be non-negative integers, got ${w}`);
    }
  }
  const sumW = weights.reduce((s, w) => s + w, 0);
  if (sumW === 0) {
    if (totalPaise === 0) return weights.map(() => 0);
    throw new RangeError(`allocate: cannot split ${totalPaise} over zero weights`);
  }
  const t = BigInt(totalPaise);
  const W = BigInt(sumW);
  const parts = weights.map((w) => Number((t * BigInt(w)) / W));
  let remainder = totalPaise - parts.reduce((s, p) => s + p, 0);
  const order = weights
    .map((w, i) => ({ w, i }))
    .filter(({ w }) => w > 0)
    .sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length, remainder--) {
    parts[order[k].i] += 1;
  }
  return parts;
}

export function quoteOrder(input: QuoteInput): Quote {
  const { lines, promo, shippingRate } = input;
  if (lines.length === 0) throw new RangeError("quoteOrder: no lines");
  assertMoney("creditRequested", input.creditRequested);
  assertMoney("creditAvailable", input.creditAvailable);
  assertMoney("voucherValue", input.voucherValue);

  const lineValues = lines.map((l) => {
    assertMoney(`unitPrice of ${l.itemKey}`, l.unitPrice);
    if (!Number.isSafeInteger(l.qty) || l.qty < 1) {
      throw new RangeError(`qty of ${l.itemKey} must be a positive integer, got ${l.qty}`);
    }
    return toPaise(l.unitPrice) * l.qty;
  });
  const subtotal = lineValues.reduce((s, v) => s + v, 0);

  const promoP = toPaise(promoDiscount(promo, toRupees(subtotal)));
  const promoShares = allocate(promoP, lineValues);
  const paidValues = lineValues.map((v, i) => v - promoShares[i]);
  const goods = subtotal - promoP;

  const shipping = toPaise(shippingCharge(shippingRate, toRupees(goods)));
  const due = goods + shipping;

  let voucher = Math.min(toPaise(input.voucherValue), due);
  let credit = Math.min(
    toPaise(input.creditRequested),
    toPaise(input.creditAvailable),
    due - voucher,
  );

  // R7: Cashfree can't take less than ₹1. Only adjustable when the order
  // itself is at least ₹1 (always true in practice: shipping alone is ≥ ₹10).
  const minGateway = toPaise(MIN_GATEWAY_AMOUNT);
  const gatewayBefore = due - voucher - credit;
  if (gatewayBefore > 0 && gatewayBefore < minGateway && due >= minGateway) {
    let shortfall = minGateway - gatewayBefore;
    const fromCredit = Math.min(credit, shortfall);
    credit -= fromCredit;
    shortfall -= fromCredit;
    voucher -= shortfall;
  }
  const gateway = due - voucher - credit;

  const nonGateway = voucher + credit;
  const nonGatewayGoods = Math.min(nonGateway, goods);
  const nonGatewayParts = allocate(nonGatewayGoods, paidValues);

  return {
    lines: lines.map((l, i) => ({
      ...l,
      promoShare: toRupees(promoShares[i]),
      paidValue: toRupees(paidValues[i]),
      nonGatewayPart: toRupees(nonGatewayParts[i]),
      gatewayPart: toRupees(paidValues[i] - nonGatewayParts[i]),
    })),
    subtotal: toRupees(subtotal),
    promoDiscount: toRupees(promoP),
    shipping: toRupees(shipping),
    shippingNonGateway: toRupees(nonGateway - nonGatewayGoods),
    shippingGateway: toRupees(shipping - (nonGateway - nonGatewayGoods)),
    amountDue: toRupees(due),
    creditApplied: toRupees(credit),
    voucherApplied: toRupees(voucher),
    gatewayAmount: toRupees(gateway),
    freeShippingGap: toRupees(Math.max(0, toPaise(FREE_SHIPPING_THRESHOLD) - goods)),
  };
}

/**
 * Refund value of `units` units of a quoted line, by source. Each part is
 * split per unit with allocate (first units carry the remainder paise);
 * `alreadyRefundedUnits` skips units refunded earlier, so successive partial
 * refunds sum exactly to the line's parts.
 */
export function refundSplit(
  line: QuotedLine,
  units: number,
  alreadyRefundedUnits = 0,
): { nonGateway: number; gateway: number } {
  if (
    !Number.isSafeInteger(units) || units < 0 ||
    !Number.isSafeInteger(alreadyRefundedUnits) || alreadyRefundedUnits < 0 ||
    alreadyRefundedUnits + units > line.qty
  ) {
    throw new RangeError(
      `refundSplit: units ${units} after ${alreadyRefundedUnits} out of range for qty ${line.qty}`,
    );
  }
  const ones = Array.from({ length: line.qty }, () => 1);
  const pick = (partPaise: number) =>
    allocate(partPaise, ones)
      .slice(alreadyRefundedUnits, alreadyRefundedUnits + units)
      .reduce((s, p) => s + p, 0);
  return {
    nonGateway: toRupees(pick(toPaise(line.nonGatewayPart))),
    gateway: toRupees(pick(toPaise(line.gatewayPart))),
  };
}
