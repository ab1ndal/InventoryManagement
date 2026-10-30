import { assertEquals, assertThrows } from "@std/assert";
import {
  allocate,
  type Line,
  type Promo,
  promoDiscount,
  type Quote,
  quoteOrder,
  refundSplit,
  shippingCharge,
} from "./pricing.ts";

const toPaise = (r: number) => Math.round(r * 100);
const sumPaise = (xs: number[]) => xs.reduce((s, x) => s + toPaise(x), 0);

function line(itemKey: string, unitPrice: number, qty: number): Line {
  return {
    itemKey,
    variantId: `v-${itemKey}`,
    productId: `BC25${itemKey}`,
    name: `Item ${itemKey}`,
    size: "M",
    color: "Red",
    category: "Kurti",
    unitPrice,
    qty,
  };
}

function promo(p: Partial<Promo>): Promo {
  return {
    code: "TEST",
    type: "flat",
    value: 0,
    max_discount: null,
    min_total: null,
    rules: null,
    ...p,
  };
}

const NO_TENDER = { creditRequested: 0, creditAvailable: 0, voucherValue: 0 };

/** Every invariant a quote must hold, checked to the paisa. */
function assertQuoteInvariants(q: Quote) {
  const due = toPaise(q.amountDue);
  assertEquals(sumPaise(q.lines.map((l) => l.promoShare)), toPaise(q.promoDiscount));
  assertEquals(sumPaise(q.lines.map((l) => l.paidValue)) + toPaise(q.shipping), due);
  assertEquals(toPaise(q.subtotal) - toPaise(q.promoDiscount) + toPaise(q.shipping), due);
  assertEquals(
    toPaise(q.gatewayAmount) + toPaise(q.creditApplied) + toPaise(q.voucherApplied),
    due,
  );
  assertEquals(
    sumPaise(q.lines.map((l) => l.nonGatewayPart)) + toPaise(q.shippingNonGateway),
    toPaise(q.creditApplied) + toPaise(q.voucherApplied),
  );
  assertEquals(
    sumPaise(q.lines.map((l) => l.gatewayPart)) + toPaise(q.shippingGateway),
    toPaise(q.gatewayAmount),
  );
  assertEquals(toPaise(q.shippingNonGateway) + toPaise(q.shippingGateway), toPaise(q.shipping));
  for (const l of q.lines) {
    assertEquals(toPaise(l.unitPrice) * l.qty - toPaise(l.promoShare), toPaise(l.paidValue));
    assertEquals(toPaise(l.nonGatewayPart) + toPaise(l.gatewayPart), toPaise(l.paidValue));
    if (l.promoShare < 0 || l.nonGatewayPart < 0 || l.gatewayPart < 0) {
      throw new Error(`negative part on ${l.itemKey}: ${JSON.stringify(l)}`);
    }
    // Refunding all units returns exactly the line's parts.
    assertEquals(refundSplit(l, l.qty), { nonGateway: l.nonGatewayPart, gateway: l.gatewayPart });
    // Refunding one unit at a time sums to the same parts.
    let ng = 0, gw = 0;
    for (let u = 0; u < l.qty; u++) {
      const r = refundSplit(l, 1, u);
      ng += toPaise(r.nonGateway);
      gw += toPaise(r.gateway);
    }
    assertEquals(ng, toPaise(l.nonGatewayPart));
    assertEquals(gw, toPaise(l.gatewayPart));
  }
  if (q.gatewayAmount < 0 || q.creditApplied < 0 || q.voucherApplied < 0) {
    throw new Error(`negative total: ${JSON.stringify(q)}`);
  }
}

// ---------- shippingCharge ----------

Deno.test("shippingCharge rounds rate up to next ₹10", () => {
  assertEquals(shippingCharge(73, 1200), 80);
  assertEquals(shippingCharge(80, 1200), 80);
  assertEquals(shippingCharge(80.01, 1200), 90);
});

Deno.test("shippingCharge falls back to ₹150 without a rate", () => {
  assertEquals(shippingCharge(null, 1200), 150);
  assertEquals(shippingCharge(0, 1200), 150);
  assertEquals(shippingCharge(Number.NaN, 1200), 150);
});

Deno.test("shippingCharge uses the given fallback without a rate", () => {
  assertEquals(shippingCharge(null, 1200, 190), 190);
  assertEquals(shippingCharge(120, 1200, 190), 120);
  assertEquals(shippingCharge(null, 5000, 190), 0);
});

Deno.test("shippingCharge is free at ₹5,000 and above", () => {
  assertEquals(shippingCharge(120, 5000), 0);
  assertEquals(shippingCharge(null, 5000), 0);
  assertEquals(shippingCharge(120, 4999.99), 120);
});

// ---------- promoDiscount (mirrors billUtils.valueOfDiscount) ----------

Deno.test("percentage promo capped by max_discount", () => {
  assertEquals(promoDiscount(promo({ type: "percentage", value: 10, max_discount: 300 }), 4000), 300);
  assertEquals(promoDiscount(promo({ type: "percentage", value: 10 }), 4000), 400);
  assertEquals(promoDiscount(promo({ type: "percentage", value: 10 }), 333.33), 33.33);
});

Deno.test("conditional promo below min_total gives 0", () => {
  const p = promo({ type: "conditional", value: 500, min_total: 3000 });
  assertEquals(promoDiscount(p, 2999), 0);
  assertEquals(promoDiscount(p, 3000), 500);
  const viaRules = promo({ type: "conditional", rules: { min_total: 3000, value: 400 } });
  assertEquals(promoDiscount(viaRules, 2500), 0);
  assertEquals(promoDiscount(viaRules, 3500), 400);
});

Deno.test("flat promo honours min_total and max_discount, never exceeds subtotal", () => {
  assertEquals(promoDiscount(promo({ type: "flat", value: 200, min_total: 1000 }), 999), 0);
  assertEquals(promoDiscount(promo({ type: "flat", value: 200, max_discount: 150 }), 1000), 150);
  assertEquals(promoDiscount(promo({ type: "flat", value: 200, max_discount: 0 }), 1000), 0);
  assertEquals(promoDiscount(promo({ type: "flat", value: 500 }), 300), 300);
  assertEquals(promoDiscount(null, 1000), 0);
});

// ---------- allocate ----------

Deno.test("allocate sums exactly, remainder to largest weights first", () => {
  assertEquals(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assertEquals(allocate(100, [1, 2, 1]), [25, 50, 25]);
  assertEquals(allocate(101, [1, 2, 1]), [25, 51, 25]);
  assertEquals(allocate(0, [5, 5]), [0, 0]);
  assertEquals(allocate(0, [0, 0]), [0, 0]);
  assertEquals(allocate(7, [0, 3, 0]), [0, 7, 0]);
});

Deno.test("allocate never gives a part more than its weight when total ≤ Σweights", () => {
  assertEquals(allocate(299, [100, 100, 100]), [100, 100, 99]);
});

Deno.test("allocate rejects bad input", () => {
  assertThrows(() => allocate(5, [0, 0]), RangeError);
  assertThrows(() => allocate(1.5, [1]), RangeError);
  assertThrows(() => allocate(-1, [1]), RangeError);
  assertThrows(() => allocate(1, [-1, 2]), RangeError);
});

// ---------- quoteOrder ----------

const THREE_LINES = [line("A", 1000, 1), line("B", 1500, 2), line("C", 333, 3)];

Deno.test("3-line quote: 10% promo, rate 73, credit 500", () => {
  const q = quoteOrder({
    lines: THREE_LINES,
    promo: promo({ type: "percentage", value: 10 }),
    shippingRate: 73,
    creditRequested: 500,
    creditAvailable: 800,
    voucherValue: 0,
  });
  assertEquals(q.subtotal, 4999);
  assertEquals(q.promoDiscount, 499.9);
  assertEquals(q.shipping, 80);
  assertEquals(q.amountDue, 4579.1);
  assertEquals(q.creditApplied, 500);
  assertEquals(q.voucherApplied, 0);
  assertEquals(q.gatewayAmount, 4079.1);
  assertEquals(sumPaise(q.lines.map((l) => l.promoShare)), toPaise(q.promoDiscount));
  assertEquals(sumPaise(q.lines.map((l) => l.nonGatewayPart)), 50000);
  assertEquals(q.shippingNonGateway, 0);
  assertEquals(q.shippingGateway, 80);
  assertEquals(q.freeShippingGap, 500.9);
  assertQuoteInvariants(q);
});

Deno.test("credit capped by requested, available and remaining", () => {
  const base = { lines: [line("A", 1000, 1)], promo: null, shippingRate: 73, voucherValue: 0 };
  assertEquals(quoteOrder({ ...base, creditRequested: 300, creditAvailable: 200 }).creditApplied, 200);
  assertEquals(quoteOrder({ ...base, creditRequested: 150, creditAvailable: 200 }).creditApplied, 150);
  const all = quoteOrder({ ...base, creditRequested: 5000, creditAvailable: 5000 });
  assertEquals(all.creditApplied, 1080);
  assertEquals(all.gatewayAmount, 0);
  assertEquals(all.shippingNonGateway, 80);
  assertQuoteInvariants(all);
});

Deno.test("voucher applied before credit", () => {
  const q = quoteOrder({
    lines: [line("A", 1000, 1)],
    promo: null,
    shippingRate: 73,
    creditRequested: 1000,
    creditAvailable: 1000,
    voucherValue: 700,
  });
  assertEquals(q.voucherApplied, 700);
  assertEquals(q.creditApplied, 380);
  assertEquals(q.gatewayAmount, 0);
  assertQuoteInvariants(q);
});

Deno.test("voucher larger than due: gateway 0, voucherApplied = due", () => {
  const q = quoteOrder({
    lines: THREE_LINES,
    promo: null,
    shippingRate: null,
    creditRequested: 100,
    creditAvailable: 100,
    voucherValue: 10000,
  });
  assertEquals(q.gatewayAmount, 0);
  assertEquals(q.voucherApplied, q.amountDue);
  assertEquals(q.creditApplied, 0);
  assertQuoteInvariants(q);
});

Deno.test("free-shipping gap is clamped at 0", () => {
  const near = quoteOrder({ lines: [line("A", 4200, 1)], promo: null, shippingRate: 73, ...NO_TENDER });
  assertEquals(near.freeShippingGap, 800);
  const promoPushesBelow = quoteOrder({
    lines: [line("A", 5100, 1)],
    promo: promo({ type: "flat", value: 200 }),
    shippingRate: 73,
    ...NO_TENDER,
  });
  assertEquals(promoPushesBelow.freeShippingGap, 100);
  assertEquals(promoPushesBelow.shipping, 80);
  const over = quoteOrder({ lines: [line("A", 6000, 1)], promo: null, shippingRate: 73, ...NO_TENDER });
  assertEquals(over.freeShippingGap, 0);
  assertEquals(over.shipping, 0);
});

Deno.test("store pickup: no shipping below ₹5,000 and no free-shipping gap", () => {
  const q = quoteOrder({ lines: [line("A", 1200, 1)], promo: null, shippingRate: 73, pickup: true, ...NO_TENDER });
  assertEquals([q.shipping, q.freeShippingGap, q.amountDue, q.gatewayAmount], [0, 0, 1200, 1200]);
  assertEquals([q.shippingGateway, q.shippingNonGateway], [0, 0]);
});

Deno.test("quoteOrder rejects invalid input", () => {
  const base = { promo: null, shippingRate: 73, ...NO_TENDER };
  assertThrows(() => quoteOrder({ ...base, lines: [] }), RangeError);
  assertThrows(() => quoteOrder({ ...base, lines: [line("A", 100, 0)] }), RangeError);
  assertThrows(() => quoteOrder({ ...base, lines: [line("A", 100, 1.5)] }), RangeError);
  assertThrows(() => quoteOrder({ ...base, lines: [line("A", -1, 1)] }), RangeError);
  assertThrows(
    () => quoteOrder({ ...base, lines: [line("A", 100, 1)], creditRequested: -5 }),
    RangeError,
  );
});

// ---------- R7: ₹1 gateway minimum ----------

/** 1000 goods + 80 shipping = 1080 due; tender is credit (then voucher). */
function r7(creditRequested: number, voucherValue = 0) {
  return quoteOrder({
    lines: [line("A", 1000, 1)],
    promo: null,
    shippingRate: 73,
    creditRequested,
    creditAvailable: creditRequested,
    voucherValue,
  });
}

Deno.test("R7 due − tender = 0: fully covered, gateway 0", () => {
  const q = r7(1080);
  assertEquals(q.gatewayAmount, 0);
  assertEquals(q.creditApplied, 1080);
  assertQuoteInvariants(q);
});

Deno.test("R7 due − tender = 0.01: credit reduced so gateway = 1.00", () => {
  const q = r7(1079.99);
  assertEquals(q.gatewayAmount, 1);
  assertEquals(q.creditApplied, 1079);
  assertQuoteInvariants(q);
});

Deno.test("R7 due − tender = 0.99: credit reduced so gateway = 1.00", () => {
  const q = r7(1079.01);
  assertEquals(q.gatewayAmount, 1);
  assertEquals(q.creditApplied, 1079);
  assertQuoteInvariants(q);
});

Deno.test("R7 due − tender = 1.00: unchanged", () => {
  const q = r7(1079);
  assertEquals(q.gatewayAmount, 1);
  assertEquals(q.creditApplied, 1079);
  assertQuoteInvariants(q);
});

Deno.test("R7 reduces credit first, then voucher", () => {
  // voucher 1079.50 + credit 0.30 = 1079.80 → gateway 0.20; shortfall 0.80.
  const q = r7(0.3, 1079.5);
  assertEquals(q.gatewayAmount, 1);
  assertEquals(q.creditApplied, 0);
  assertEquals(q.voucherApplied, 1079);
  assertQuoteInvariants(q);
});

Deno.test("R7 does nothing when no credit or voucher was applied", () => {
  const q = quoteOrder({
    lines: [line("A", 0.5, 1)],
    promo: null,
    shippingRate: null,
    ...NO_TENDER,
  });
  assertEquals(q.amountDue, 150.5);
  assertEquals(q.gatewayAmount, 150.5);
  assertQuoteInvariants(q);
});

// ---------- refundSplit ----------

Deno.test("refundSplit: first units carry the remainder", () => {
  const q = quoteOrder({
    lines: [line("C", 333.34, 3)],
    promo: null,
    shippingRate: 73,
    creditRequested: 100,
    creditAvailable: 100,
    voucherValue: 0,
  });
  const l = q.lines[0];
  assertEquals(l.nonGatewayPart, 100);
  assertEquals(l.gatewayPart, 900.02);
  assertEquals(refundSplit(l, 1), { nonGateway: 33.34, gateway: 300.01 });
  assertEquals(refundSplit(l, 1, 1), { nonGateway: 33.33, gateway: 300.01 });
  assertEquals(refundSplit(l, 1, 2), { nonGateway: 33.33, gateway: 300 });
  assertEquals(refundSplit(l, 2, 1), { nonGateway: 66.66, gateway: 600.01 });
  assertEquals(refundSplit(l, 0), { nonGateway: 0, gateway: 0 });
  assertThrows(() => refundSplit(l, 4), RangeError);
  assertThrows(() => refundSplit(l, 2, 2), RangeError);
  assertThrows(() => refundSplit(l, 1.5), RangeError);
});

// ---------- property test ----------

/** mulberry32: small deterministic PRNG so failures reproduce. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("property: 500 random quotes are exact to the paisa", () => {
  const rand = mulberry32(20261023);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const promoTypes: Promo["type"][] = ["flat", "percentage", "conditional"];
  for (let i = 0; i < 500; i++) {
    const lines: Line[] = [];
    const n = int(1, 6);
    for (let j = 0; j < n; j++) {
      // Prices in paise, mostly whole rupees, sometimes odd paise.
      const pricePaise = rand() < 0.7 ? int(1, 8000) * 100 : int(1, 800000);
      lines.push(line(`${i}-${j}`, pricePaise / 100, int(1, 5)));
    }
    const p = rand() < 0.25 ? null : promo({
      type: promoTypes[int(0, 2)],
      value: rand() < 0.5 ? int(1, 60) : int(1, 300000) / 100,
      max_discount: rand() < 0.5 ? null : int(0, 2000),
      min_total: rand() < 0.5 ? null : int(0, 6000),
    });
    const credit = rand() < 0.4 ? 0 : int(0, 3000000) / 100;
    const q = quoteOrder({
      lines,
      promo: p,
      shippingRate: rand() < 0.2 ? null : int(1, 30000) / 100,
      creditRequested: credit,
      creditAvailable: rand() < 0.5 ? credit : int(0, 3000000) / 100,
      voucherValue: rand() < 0.6 ? 0 : int(0, 3000000) / 100,
    });
    try {
      assertQuoteInvariants(q);
      if (q.gatewayAmount > 0 && q.gatewayAmount < 1 && q.creditApplied + q.voucherApplied > 0) {
        throw new Error("R7 violated");
      }
    } catch (e) {
      throw new Error(`iteration ${i}: ${(e as Error).message}\n${JSON.stringify(q)}`);
    }
  }
});
