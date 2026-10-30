/**
 * Server-side quote (plan Task 4, R7, R8, R9, R16): loads prices from the
 * database, checks the code and store credit, gets the courier rate, then
 * prices with the pure `quoteOrder`. Used by checkout-quote (response shape)
 * and create-order (which also needs the `online_order_create` payload).
 *
 * Never trusts the client for money: the request carries only variant ids,
 * quantities, the pincode, the code and how much credit to use.
 */

import { type Line, type Promo, promoDiscount, type Quote, quoteOrder } from "./pricing.ts";
import { checkPincode, isPincodeFormat, type PincodeCheck } from "./pincode.ts";
import { chargeableWeightKg, fallbackShippingCharge, fallbackShippingChargeIndia } from "./shipping.ts";
import type { ShiprocketClient } from "./shiprocket.ts";
import { ApiError, type Store, type VariantRow } from "./context.ts";
import { availableByVariant } from "./holds.ts";

export const MAX_LINES = 30;
export const MAX_QTY = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type QuoteItem = { variantId: string; qty: number };

export type Fulfilment = "ship" | "pickup";

export type QuoteRequest = {
  items: QuoteItem[];
  pincode: string | null;
  code: string | null;
  creditRequested: number;
  /** Shopper phone (create-order only); feeds once-per-customer and R9 limits. */
  phone: string | null;
  /** Pickup: ₹0 shipping, no pincode check or courier rate. */
  fulfilment: Fulfilment;
};

/** holderKey: whose stock holds count as this shopper's own (u:/g: key; see holds.ts). */
export type Identity = { authUserId: string | null; ipHash: string | null; holderKey?: string | null };

export type CodeResult = {
  status: "ok" | "invalid" | "rate_limited";
  kind?: "voucher" | "promo";
  message?: string;
};

/** HTTP contract shape of checkout-quote's 200 body. */
export type QuoteResponse = {
  live: boolean;
  quote: {
    lines: {
      variantId: string;
      productId: string;
      name: string;
      size: string;
      color: string;
      unitPrice: number;
      qty: number;
      promoShare: number;
      paidValue: number;
    }[];
    subtotal: number;
    promoDiscount: number;
    shipping: number;
    voucherApplied: number;
    creditApplied: number;
    gatewayAmount: number;
    amountDue: number;
    freeShippingGap: number;
  };
  pincode: PincodeCheck | null;
  shippingSource: "rate" | "flat" | "free" | "pickup";
  code: CodeResult | null;
  creditAvailable: number;
  unavailable: { variantId: string; available: number }[];
};

export type QuoteResult = {
  response: QuoteResponse;
  quote: Quote;
  promoCode: string | null;
  voucherCode: string | null;
  courierId: number | null;
};

export type QuoteDeps = { store: Store; shiprocket: ShiprocketClient | null };

/** Validates and normalises the cart part of a request (duplicate variants merged). */
export function parseItems(raw: unknown): QuoteItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ApiError(400, "bad_request", "items must be a non-empty array");
  const merged = new Map<string, number>();
  for (const it of raw) {
    const variantId = (it as { variantId?: unknown })?.variantId;
    const qty = (it as { qty?: unknown })?.qty;
    if (typeof variantId !== "string" || !UUID_RE.test(variantId)) {
      throw new ApiError(400, "bad_request", "each item needs a variantId (uuid)");
    }
    if (typeof qty !== "number" || !Number.isSafeInteger(qty) || qty < 1) {
      throw new ApiError(400, "bad_request", "each item needs a positive integer qty");
    }
    merged.set(variantId.toLowerCase(), (merged.get(variantId.toLowerCase()) ?? 0) + qty);
  }
  if (merged.size > MAX_LINES) throw new ApiError(400, "bad_request", `at most ${MAX_LINES} different items`);
  const items = [...merged].map(([variantId, qty]) => ({ variantId, qty }));
  if (items.some((i) => i.qty > MAX_QTY)) throw new ApiError(400, "bad_request", `at most ${MAX_QTY} of one item`);
  return items;
}

/** Omitted means ship (clients from before store pickup). */
export function parseFulfilment(raw: unknown): Fulfilment {
  if (raw === undefined || raw === null) return "ship";
  if (raw !== "ship" && raw !== "pickup") throw new ApiError(400, "bad_request", "fulfilment must be ship or pickup");
  return raw;
}

export function parseCredit(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new ApiError(400, "bad_request", "creditRequested must be a number ≥ 0");
  }
  return Math.round(raw * 100) / 100;
}

export function optionalString(raw: unknown, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new ApiError(400, "bad_request", `${field} must be a string`);
  const t = raw.trim();
  return t === "" ? null : t;
}

type CodeCheckRow = {
  status: "ok" | "invalid" | "rate_limited";
  kind?: "voucher" | "promo";
  code?: string;
  value?: number | string;
  type?: Promo["type"];
  max_discount?: number | string | null;
  min_total?: number | string | null;
  rules?: Record<string, unknown> | null;
};

/** ₹1,250 / ₹1,250.50 (en-IN grouping, no .00). */
export function formatInr(n: number): string {
  const whole = Math.round(n * 100) % 100 === 0;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

const numOrNull =(v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export async function buildQuote(deps: QuoteDeps, req: QuoteRequest, who: Identity): Promise<QuoteResult> {
  const { store, shiprocket } = deps;

  const ids = req.items.map((i) => i.variantId);
  const [live, variantRows, held] = await Promise.all([
    store.checkoutLive(),
    store.variants(ids),
    availableByVariant(store, ids, who.holderKey ?? null),
  ]);
  const byId = new Map<string, VariantRow>(variantRows.map((v) => [v.variantId.toLowerCase(), v]));

  const unavailable: QuoteResponse["unavailable"] = [];
  const lines: Line[] = [];
  for (const it of req.items) {
    const v = byId.get(it.variantId);
    if (!v || !Number.isFinite(v.retailPrice) || v.retailPrice <= 0) {
      unavailable.push({ variantId: it.variantId, available: 0 });
      continue;
    }
    // Units in other shoppers' carts / pending orders are not for sale to this one.
    const available = held.get(v.variantId.toLowerCase()) ?? Math.max(0, Math.floor(v.stock));
    if (available < it.qty) unavailable.push({ variantId: v.variantId, available });
    lines.push({
      itemKey: v.variantId,
      variantId: v.variantId,
      productId: v.productId,
      name: v.name,
      size: v.size,
      color: v.color,
      category: v.categoryName ?? v.categoryId,
      unitPrice: v.retailPrice,
      qty: it.qty,
    });
  }
  if (lines.length === 0) throw new ApiError(409, "out_of_stock", "none of these items are available");

  // Code: voucher first, then promo (inside online_code_check); identity only from the JWT (R8).
  let code: CodeResult | null = null;
  let promo: Promo | null = null;
  let voucherValue = 0;
  let voucherCode: string | null = null;
  if (req.code) {
    const row = await store.rpc<CodeCheckRow>("online_code_check", {
      p_code: req.code,
      p_phone: req.phone,
      p_auth_user: who.authUserId,
      p_ip_hash: who.ipHash,
    });
    if (row?.status === "ok" && row.kind === "voucher") {
      voucherValue = Number(row.value ?? 0);
      voucherCode = String(row.code ?? req.code);
      code = { status: "ok", kind: "voucher" };
    } else if (row?.status === "ok" && row.kind === "promo" && row.type) {
      promo = {
        code: String(row.code ?? req.code),
        type: row.type,
        value: Number(row.value ?? 0),
        max_discount: numOrNull(row.max_discount),
        min_total: numOrNull(row.min_total),
        rules: row.rules ?? null,
      };
      code = { status: "ok", kind: "promo" };
    } else if (row?.status === "rate_limited") {
      code = { status: "rate_limited", message: "Too many code attempts. Please try again later." };
    } else {
      // Identical for "not found" and "not eligible" (R9).
      code = { status: "invalid", message: "That code isn't valid." };
    }
  }

  const creditAvailable = who.authUserId ? (await store.creditBalance(who.authUserId)) ?? 0 : 0;

  // Pincode (R16) and courier rate; the rate never blocks checkout (weight-slab fallback).
  // The rate needs only a well-formed pincode, so both Shiprocket lookups run in parallel.
  const postcodeDetails = shiprocket ? (pc: string) => shiprocket.postcodeDetails(pc) : () => Promise.resolve(null);
  const pickup = req.fulfilment === "pickup";
  const pin = pickup || req.pincode === null ? null : req.pincode.trim();

  const subtotal = lines.reduce((s, l) => s + Math.round(l.unitPrice * 100) * l.qty, 0) / 100;
  const goods = subtotal - promoDiscount(promo, subtotal);
  const weightKg = chargeableWeightKg(lines.flatMap((l) => Array.from({ length: l.qty }, () => l.category)));
  const [pincode, rate] = await Promise.all([
    pin === null ? Promise.resolve(null) : checkPincode(pin, postcodeDetails),
    pin !== null && goods < 5000 && shiprocket && isPincodeFormat(pin)
      ? shiprocket.rate({ deliveryPincode: pin, weightKg, declaredValue: Math.round(goods * 100) / 100 })
      : Promise.resolve(null),
  ]);
  const shippingRate: number | null = rate ? rate.rate : null;
  const courierId: number | null = rate ? rate.courierId : null;

  const quote = quoteOrder({
    lines,
    promo,
    shippingRate,
    // National slabs outside UP; with no pincode yet the UP estimate shows.
    fallbackShipping: pincode?.ok && !pincode.inUp ? fallbackShippingChargeIndia(weightKg) : fallbackShippingCharge(weightKg),
    pickup,
    creditRequested: req.creditRequested,
    creditAvailable,
    voucherValue,
  });
  const shippingSource = pickup ? "pickup" : quote.shipping === 0 ? "free" : shippingRate !== null ? "rate" : "flat";
  if (code?.kind === "voucher") {
    const leftPaise = Math.round(voucherValue * 100) - Math.round(quote.voucherApplied * 100);
    if (leftPaise > 0) code.message = `${formatInr(leftPaise / 100)} left on your voucher will be emailed to you after you pay.`;
  }

  return {
    quote,
    // A promo worth nothing here (e.g. min_total not met) is not sent, so it reserves nothing.
    promoCode: promo && quote.promoDiscount > 0 ? promo.code : null,
    voucherCode: quote.voucherApplied > 0 ? voucherCode : null,
    courierId: shippingSource === "rate" ? courierId : null,
    response: {
      live,
      quote: {
        lines: quote.lines.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          name: l.name,
          size: l.size,
          color: l.color,
          unitPrice: l.unitPrice,
          qty: l.qty,
          promoShare: l.promoShare,
          paidValue: l.paidValue,
        })),
        subtotal: quote.subtotal,
        promoDiscount: quote.promoDiscount,
        shipping: quote.shipping,
        voucherApplied: quote.voucherApplied,
        creditApplied: quote.creditApplied,
        gatewayAmount: quote.gatewayAmount,
        amountDue: quote.amountDue,
        freeShippingGap: quote.freeShippingGap,
      },
      pincode,
      shippingSource,
      code,
      creditAvailable,
      unavailable,
    },
  };
}

export type OrderContact = { name: string; phone: string; email: string | null };

/**
 * Arguments for online_order_create (migration CONTRACT). credit_part is the
 * line's nonGatewayPart (voucher + credit); the DB re-checks every sum.
 */
export function orderPayload(
  result: QuoteResult,
  extra: {
    attemptKey: string;
    contact: OrderContact;
    address: Record<string, unknown>;
    accessTokenHash: string;
    fulfilment: Fulfilment;
    holderKey: string | null;
  },
): { p_order: Record<string, unknown>; p_items: Record<string, unknown>[] } {
  const q = result.quote;
  return {
    p_order: {
      attempt_key: extra.attemptKey,
      contact: extra.contact,
      address: extra.address,
      promo_code: result.promoCode,
      voucher_code: result.voucherCode,
      subtotal: q.subtotal,
      promo_discount: q.promoDiscount,
      shipping: q.shipping,
      voucher_applied: q.voucherApplied,
      credit_applied: q.creditApplied,
      gateway_amount: q.gatewayAmount,
      quoted_courier_id: result.courierId,
      access_token_hash: extra.accessTokenHash,
      fulfilment: extra.fulfilment,
      holder_key: extra.holderKey,
    },
    p_items: q.lines.map((l) => ({
      variant_id: l.variantId,
      qty: l.qty,
      unit_price: l.unitPrice,
      promo_share: l.promoShare,
      credit_part: l.nonGatewayPart,
    })),
  };
}
