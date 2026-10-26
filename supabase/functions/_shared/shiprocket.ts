/**
 * Shiprocket API v2 client.
 * Facts: docs/superpowers/specs/2026-10-23-api-notes-shiprocket.md.
 * Plan: Task 3, R17 (billing_email fallback), R18 (rate selection),
 * R19 (manifest/label success needs more than HTTP 200).
 *
 * Token: cached in `tokenStore` (DB-backed `integration_tokens` in prod).
 * A token is valid 10 days; we log in again when < 24 h is left, and once
 * more on a 401 (retry that request once).
 *
 * Lookups used at checkout (postcodeState, rate) never throw: any failure
 * is null, and the caller applies its fallback (R16 pincode rule, ₹99 flat).
 * Every other method throws ShiprocketError, so Process can stop and retry.
 */

import { type Delay, type FetchFn, fetchWithTimeout, realDelay } from "./timeout.ts";

export const SHIPROCKET_BASE_URL = "https://apiv2.shiprocket.in/v1/external";
export const PICKUP_LOCATION = "Shop";
export const PICKUP_PINCODE = "201001";
export const TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;
export const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
/** Checkout lookups (rate, postcode): spec §7 "no rate within 5 s → ₹99". */
export const LOOKUP_TIMEOUT_MS = 5_000;
export const CALL_TIMEOUT_MS = 20_000;
const BILLING_CITY_MAX = 30;

export class ShiprocketError extends Error {
  constructor(
    /** HTTP status; 0 = no response (timeout/network); 200 = HTTP OK but the body reports failure. */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ShiprocketError";
  }
}

export type TokenStore = {
  get(): Promise<{ token: string; expiresAt: Date } | null>;
  set(token: string, expiresAt: Date): Promise<void>;
};

export type RateQuote = { rate: number; courierId: number; courierName: string; etdDays: number | null };

export type SrOrderInput = {
  /** Our ref (WEB-000001), sent as Shiprocket `order_id`. */
  orderRef: string;
  orderDate: Date;
  billing: {
    name: string;
    lastName?: string;
    address: string;
    address2?: string;
    city: string;
    pincode: string;
    state: string;
    phone: string;
    /** Shopper email; may be empty (R17). */
    email: string | null;
  };
  items: { name: string; sku: string; units: number; sellingPrice: number }[];
  subTotal: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  weightKg: number;
  shippingCharges?: number;
};

export type SrOrderIds = { srOrderId: number; shipmentId: number };
export type AwbResult = { awb: string; courierId: number; courierName: string };
export type PickupResult = { scheduledDate: string | null; tokenNumber: string | null };
export type TrackResult = {
  /** false = no scans yet; keep the current state. */
  hasData: boolean;
  /** SHIPMENT scheme id, for mapShipmentStatus. */
  shipmentStatusId: number | null;
  currentStatus: string | null;
  trackUrl: string | null;
  etd: string | null;
};

export type ShiprocketClient = {
  token(): Promise<string>;
  postcodeState(pincode: string): Promise<string | null>;
  rate(input: { deliveryPincode: string; weightKg: number; declaredValue: number }): Promise<RateQuote | null>;
  createOrder(input: SrOrderInput, fallbackEmail: string): Promise<SrOrderIds>;
  updateOrder(input: SrOrderInput, fallbackEmail: string): Promise<SrOrderIds>;
  assignAwb(shipmentId: number, courierId?: number): Promise<AwbResult>;
  pickup(shipmentId: number): Promise<PickupResult>;
  manifest(shipmentId: number, srOrderId: number): Promise<string>;
  label(shipmentId: number): Promise<string>;
  cancel(srOrderIds: number[]): Promise<void>;
  cancelAwbs(awbs: string[]): Promise<void>;
  track(awb: string): Promise<TrackResult>;
};

export type ShiprocketConfig = {
  email: string;
  password: string;
  fetch: FetchFn;
  tokenStore: TokenStore;
  now?: () => Date;
  delay?: Delay;
};

type Json = Record<string, unknown>;

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** "yyyy-mm-dd HH:MM" in IST, the format create/adhoc documents. */
export function srOrderDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * R18: the recommended courier if it is listed and usable; else the lowest
 * etd_hours, ties broken by the lower rate. Usable = not blocked, finite
 * rate > 0. Numbers may arrive as strings.
 */
export function selectCourier(body: unknown): RateQuote | null {
  const b = body as Json | null;
  // HTTP 200 with body status 404 is a documented failure.
  if (!b || num(b.status) !== 200 || typeof b.data !== "object" || b.data === null) return null;
  const data = b.data as Json;
  const list = Array.isArray(data.available_courier_companies) ? data.available_courier_companies as Json[] : [];
  const blockedIds = new Set(
    (Array.isArray(data.blocked_courier_companies) ? data.blocked_courier_companies as Json[] : [])
      .map((c) => num(c.courier_company_id)),
  );
  const usable = list
    .map((c) => ({
      courierId: num(c.courier_company_id),
      courierName: String(c.courier_name ?? ""),
      rate: num(c.rate),
      etdHours: num(c.etd_hours),
      etdDays: num(c.estimated_delivery_days),
      blocked: num(c.blocked) === 1,
    }))
    .filter((c) =>
      Number.isFinite(c.courierId) && Number.isFinite(c.rate) && c.rate > 0 && !c.blocked &&
      !blockedIds.has(c.courierId)
    );
  if (usable.length === 0) return null;

  const recommendedId = num(data.recommended_courier_company_id);
  let pick = usable.find((c) => c.courierId === recommendedId);
  if (!pick) {
    const etd = (h: number) => (Number.isFinite(h) ? h : Infinity);
    pick = [...usable].sort((a, b) => etd(a.etdHours) - etd(b.etdHours) || a.rate - b.rate)[0];
  }
  return {
    rate: pick.rate,
    courierId: pick.courierId,
    courierName: pick.courierName,
    etdDays: Number.isFinite(pick.etdDays) ? pick.etdDays : null,
  };
}

export function createShiprocket(config: ShiprocketConfig): ShiprocketClient {
  const now = config.now ?? (() => new Date());
  const delay = config.delay ?? realDelay;
  let loginInFlight: Promise<string> | null = null;

  async function send(
    method: string,
    path: string,
    init: { body?: unknown; token?: string; timeoutMs: number },
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    let res: Response;
    try {
      res = await fetchWithTimeout(
        config.fetch,
        SHIPROCKET_BASE_URL + path,
        { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) },
        init.timeoutMs,
        delay,
      );
    } catch (err) {
      throw new ShiprocketError(0, `${method} ${path}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: res.status, data };
  }

  function login(): Promise<string> {
    if (loginInFlight) return loginInFlight;
    loginInFlight = (async () => {
      if (!config.email || !config.password) {
        throw new ShiprocketError(0, "Shiprocket is not configured (API email/password missing)");
      }
      const { status, data } = await send("POST", "/auth/login", {
        body: { email: config.email, password: config.password },
        timeoutMs: CALL_TIMEOUT_MS,
      });
      // UNVERIFIED: login response carries the JWT in `token`.
      const token = (data as Json | null)?.token;
      if (status !== 200 || typeof token !== "string" || !token) {
        throw new ShiprocketError(status, `login failed: HTTP ${status}`);
      }
      // Our own clock, not the JWT's exp: the docs promise 10 days.
      await config.tokenStore.set(token, new Date(now().getTime() + TOKEN_TTL_MS));
      return token;
    })().finally(() => {
      loginInFlight = null;
    });
    return loginInFlight;
  }

  async function token(): Promise<string> {
    const cached = await config.tokenStore.get();
    if (cached && cached.expiresAt.getTime() - now().getTime() >= TOKEN_REFRESH_MARGIN_MS) {
      return cached.token;
    }
    return login();
  }

  /** Authenticated call; on 401 logs in again and retries once. */
  async function api(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<{ status: number; data: unknown }> {
    let res = await send(method, path, { body, token: await token(), timeoutMs });
    if (res.status === 401) {
      res = await send(method, path, { body, token: await login(), timeoutMs });
    }
    return res;
  }

  function fail(path: string, status: number, data: unknown): never {
    const msg = typeof (data as Json | null)?.message === "string" ? (data as Json).message : `HTTP ${status}`;
    throw new ShiprocketError(status, `${path}: ${msg}`);
  }

  /** Throws unless HTTP 2xx; returns the parsed body. */
  async function ok(method: string, path: string, body?: unknown): Promise<Json> {
    const { status, data } = await api(method, path, body);
    if (status < 200 || status >= 300) fail(path, status, data);
    return (data ?? {}) as Json;
  }

  function orderBody(input: SrOrderInput, fallbackEmail: string): Json {
    const b = input.billing;
    // R17: billing_email is required; shopper email if present, else the shop's.
    const email = b.email?.trim() || fallbackEmail.trim();
    if (!email) throw new RangeError("billing email: shopper email and fallback are both empty");
    const body: Json = {
      // UNVERIFIED: docs advise digits and dashes; effect of letters (WEB-) on other calls unknown.
      order_id: input.orderRef,
      order_date: srOrderDate(input.orderDate),
      pickup_location: PICKUP_LOCATION,
      billing_customer_name: b.name,
      billing_address: b.address,
      billing_city: b.city.slice(0, BILLING_CITY_MAX),
      billing_pincode: b.pincode,
      billing_state: b.state,
      billing_country: "India",
      billing_email: email,
      billing_phone: b.phone,
      shipping_is_billing: true,
      order_items: input.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.units,
        selling_price: i.sellingPrice,
      })),
      payment_method: "Prepaid",
      sub_total: input.subTotal,
      length: input.lengthCm,
      breadth: input.breadthCm,
      height: input.heightCm,
      weight: input.weightKg,
    };
    if (b.lastName) body.billing_last_name = b.lastName;
    if (b.address2) body.billing_address_2 = b.address2;
    if (input.shippingCharges !== undefined) body.shipping_charges = input.shippingCharges;
    return body;
  }

  function orderIds(path: string, d: Json): SrOrderIds {
    const srOrderId = num(d.order_id);
    const shipmentId = num(d.shipment_id);
    if (!Number.isFinite(srOrderId) || !Number.isFinite(shipmentId)) fail(path, 200, d);
    return { srOrderId, shipmentId };
  }

  return {
    token,

    async postcodeState(pincode) {
      try {
        const path = `/open/postcode/details?postcode=${encodeURIComponent(pincode)}`;
        // UNVERIFIED: whether /open/ needs the token; we always send it.
        const { status, data } = await api("GET", path, undefined, LOOKUP_TIMEOUT_MS);
        const d = data as Json | null;
        const state = (d?.postcode_details as Json | undefined)?.state;
        if (status !== 200 || d?.success !== true || typeof state !== "string" || !state.trim()) return null;
        return state.trim();
      } catch {
        // Checkout must not fail on a lookup; null routes the caller to its R16 fallback.
        return null;
      }
    },

    async rate({ deliveryPincode, weightKg, declaredValue }) {
      try {
        const q = new URLSearchParams({
          pickup_postcode: PICKUP_PINCODE,
          delivery_postcode: deliveryPincode,
          cod: "0",
          weight: String(weightKg),
          declared_value: String(declaredValue),
        });
        const { status, data } = await api("GET", `/courier/serviceability/?${q}`, undefined, LOOKUP_TIMEOUT_MS);
        if (status !== 200) return null;
        // UNVERIFIED: unserviceable-pincode body shape; empty list/missing data/blocked → null.
        return selectCourier(data);
      } catch {
        // Timeout or network: caller charges the flat ₹99.
        return null;
      }
    },

    async createOrder(input, fallbackEmail) {
      const path = "/orders/create/adhoc";
      // UNVERIFIED: duplicate order_id response; callers check stored sr_order_id first.
      return orderIds(path, await ok("POST", path, orderBody(input, fallbackEmail)));
    },

    async updateOrder(input, fallbackEmail) {
      const path = "/orders/update/adhoc";
      // UNVERIFIED: whether sub_total/dimensions/weight update (absent from not_updated_fields).
      return orderIds(path, await ok("POST", path, orderBody(input, fallbackEmail)));
    },

    async assignAwb(shipmentId, courierId) {
      const path = "/courier/assign/awb";
      const body: Json = { shipment_id: shipmentId };
      if (courierId !== undefined) body.courier_id = courierId;
      const d = await ok("POST", path, body);
      const data = ((d.response as Json | undefined)?.data ?? {}) as Json;
      // UNVERIFIED: failure body shape; anything but awb_assign_status 1 + an AWB is failure.
      if (num(d.awb_assign_status) !== 1 || typeof data.awb_code !== "string" || !data.awb_code) {
        fail(path, 200, d);
      }
      return {
        awb: data.awb_code,
        courierId: num(data.courier_company_id),
        courierName: String(data.courier_name ?? ""),
      };
    },

    async pickup(shipmentId) {
      const path = "/courier/generate/pickup";
      const d = await ok("POST", path, { shipment_id: [shipmentId] });
      if (num(d.pickup_status) !== 1) fail(path, 200, d);
      const r = (d.response ?? {}) as Json;
      return {
        scheduledDate: typeof r.pickup_scheduled_date === "string" ? r.pickup_scheduled_date : null,
        tokenNumber: r.pickup_token_number == null ? null : String(r.pickup_token_number),
      };
    },

    async manifest(shipmentId, srOrderId) {
      const path = "/manifests/generate";
      const { status, data } = await api("POST", path, { shipment_id: [shipmentId] });
      const d = (data ?? {}) as Json;
      if (status === 200) {
        // R19: a bad id also returns 200 with manifest_url "".
        if (num(d.status) === 1 && typeof d.manifest_url === "string" && d.manifest_url) return d.manifest_url;
        fail(path, 200, d);
      }
      const already = Array.isArray(d.already_manifested_shipment_ids)
        ? (d.already_manifested_shipment_ids as unknown[]).map(num)
        : [];
      if (status !== 400 || !already.includes(shipmentId)) fail(path, status, d);
      // Already manifested (a retry): reprint to get the URL.
      // UNVERIFIED: print body `{ order_ids: [sr_order_id] }` and response `{ manifest_url }`.
      const printPath = "/manifests/print";
      const p = await ok("POST", printPath, { order_ids: [srOrderId] });
      if (typeof p.manifest_url !== "string" || !p.manifest_url) fail(printPath, 200, p);
      return p.manifest_url;
    },

    async label(shipmentId) {
      const path = "/courier/generate/label";
      const d = await ok("POST", path, { shipment_id: [shipmentId] });
      // R19: check label_created, not the HTTP status.
      if (!d.label_created || num(d.label_created) === 0 || typeof d.label_url !== "string" || !d.label_url) {
        fail(path, 200, typeof d.response === "string" ? { message: d.response } : d);
      }
      return d.label_url;
    },

    async cancel(srOrderIds) {
      if (srOrderIds.length === 0) return;
      // Success is 204 with no body.
      await ok("POST", "/orders/cancel", { ids: srOrderIds });
    },

    async cancelAwbs(awbs) {
      if (awbs.length === 0) return;
      // UNVERIFIED: success body (docs: 204 "Bulk Shipment cancellation is in progress"); any 2xx counts, body ignored.
      await ok("POST", "/orders/cancel/shipment/awbs", { awbs });
    },

    async track(awb) {
      const path = `/courier/track/awb/${encodeURIComponent(awb)}`;
      const d = await ok("GET", path);
      // UNVERIFIED: some accounts nest the payload under the AWB key.
      const td = (d.tracking_data ?? (d[awb] as Json | undefined)?.tracking_data) as Json | undefined;
      if (!td) fail(path, 200, d);
      const hasData = num(td.track_status) === 1;
      const statusId = num(td.shipment_status);
      const first = Array.isArray(td.shipment_track) ? (td.shipment_track[0] as Json | undefined) : undefined;
      return {
        hasData,
        shipmentStatusId: hasData && Number.isFinite(statusId) ? statusId : null,
        currentStatus: typeof first?.current_status === "string" ? first.current_status : null,
        trackUrl: typeof td.track_url === "string" && td.track_url ? td.track_url : null,
        etd: typeof td.etd === "string" && td.etd ? td.etd : null,
      };
    },
  };
}
