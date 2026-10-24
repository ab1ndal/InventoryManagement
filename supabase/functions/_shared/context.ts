/**
 * Wiring for the online-order Edge Functions: env → clients → deps.
 *
 * Every handler takes its dependencies as an argument (`handler(req, deps)`)
 * so tests pass fakes; only each function's index.ts calls `appDeps()`.
 *
 * `Store` is the narrow data port the Pay slice needs. All state changes go
 * through the SECURITY DEFINER functions (`rpc`); the direct table reads and
 * the two direct writes (access-token rotation, order-status rate limiting)
 * use the service role, which bypasses RLS, so a Store must never be built
 * from a user-scoped client.
 *
 * Optional integrations (Cashfree, Shiprocket, Gmail) are null / no-op when
 * their secrets are missing, so the functions can be deployed before the
 * owner's accounts exist (checkout_live stays false until then).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type CashfreeClient, type CashfreeEnv, createCashfree } from "./cashfree.ts";
import { createShiprocket, type ShiprocketClient, type TokenStore } from "./shiprocket.ts";
import { createMailer } from "./mailer.ts";
import {
  corsHeaders,
  handlePreflight,
  HttpError,
  json,
  parseAllowedOrigins,
  supabaseVerifier,
  type VerifyJwt,
} from "./http.ts";
import type { JobContext, Mailer } from "./jobs/types.ts";

// ---------------------------------------------------------------- logging

/** One JSON line per event; never pass secrets, tokens or full card/UPI data. */
export function logEvent(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- HTTP

/** An HTTP error with a contract `code` (docs/.../online-orders-http-contracts.md). */
export class ApiError extends HttpError {
  constructor(status: number, readonly code: string, message: string) {
    super(status, message);
  }
}

/**
 * Browser-facing POST endpoint: preflight, exact-origin CORS (R11), JSON
 * errors `{ error, code? }`. Unexpected errors are logged and become a bare
 * 500 so no internal detail reaches the browser.
 */
export async function browserEndpoint(
  req: Request,
  allowedOrigins: string[],
  name: string,
  body: () => Promise<unknown>,
): Promise<Response> {
  const pre = handlePreflight(req, allowedOrigins);
  if (pre) return pre;
  const cors = corsHeaders(req, allowedOrigins);
  if (req.method !== "POST") return json(405, { error: "method not allowed", code: "method_not_allowed" }, cors);
  try {
    return json(200, await body(), cors);
  } catch (err) {
    if (err instanceof ApiError) return json(err.status, { error: err.message, code: err.code }, cors);
    if (err instanceof HttpError) return json(err.status, { error: err.message }, cors);
    logEvent("error", `${name}_failed`, { error: errorMessage(err) });
    return json(500, { error: "internal error", code: "internal" }, cors);
  }
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "bad_request", "body must be JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "bad_request", "body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------- access tokens

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** R10: 32 random bytes, base64url; only the SHA-256 hex is stored. */
export async function newAccessToken(
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): Promise<{ token: string; hash: string }> {
  const token = base64url(randomBytes(32));
  return { token, hash: await sha256Hex(token) };
}

// ---------------------------------------------------------------- store

/** A database error from PostgREST / a raised exception in a SQL function. */
export class DbError extends Error {
  constructor(message: string, readonly code: string | null) {
    super(message);
    this.name = "DbError";
  }
}

export type OrderRow = {
  id: string;
  order_ref: string;
  attempt_key: string | null;
  status: string;
  customerid: number | null;
  auth_user_id: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  address: Record<string, unknown>;
  subtotal: number;
  promo_discount: number;
  shipping: number;
  voucher_applied: number;
  credit_applied: number;
  gateway_amount: number;
  cf_order_id: string | null;
  cf_payment_id: string | null;
  awb: string | null;
  courier_name: string | null;
  leftover_voucher_id: string | null;
  problem: string | null;
  created_at: string;
};

export type OrderItemRow = {
  id: string;
  line_no: number;
  product_name: string;
  size: string | null;
  color: string | null;
  qty: number;
  unit_price: number;
  paid_value: number;
  status: string;
  refunded_qty: number;
};

export type VariantRow = {
  variantId: string;
  productId: string;
  name: string;
  size: string;
  color: string;
  stock: number;
  retailPrice: number;
  categoryId: string | null;
  categoryName: string | null;
};

export type Store = {
  /** Calls a SQL function; throws DbError with the raised message. */
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  checkoutLive(): Promise<boolean>;
  variants(ids: string[]): Promise<VariantRow[]>;
  /** Store credit of the customer linked to a verified auth user; null when none is linked. */
  creditBalance(authUserId: string): Promise<number | null>;
  orderByRef(ref: string): Promise<OrderRow | null>;
  orderByAttemptKey(attemptKey: string): Promise<OrderRow | null>;
  orderById(id: string): Promise<OrderRow | null>;
  orderItems(orderId: string): Promise<OrderItemRow[]>;
  voucherValue(code: string): Promise<number | null>;
  /** R10: a retried create-order issues a fresh token (only its hash is stored). */
  setAccessTokenHash(orderId: string, hash: string): Promise<void>;
  /** Failed order-status lookups in the last hour for this key (R10 rate limit). */
  recentStatusFailures(key: string): Promise<number>;
  recordStatusFailure(key: string): Promise<void>;
};

const ORDER_COLUMNS = "id, order_ref, attempt_key, status, customerid, auth_user_id, contact_name, contact_phone, " +
  "contact_email, address, subtotal, promo_discount, shipping, voucher_applied, credit_applied, gateway_amount, " +
  "cf_order_id, cf_payment_id, awb, courier_name, leftover_voucher_id, problem, created_at";

const MONEY_KEYS = ["subtotal", "promo_discount", "shipping", "voucher_applied", "credit_applied", "gateway_amount"] as const;

function toOrder(row: Record<string, unknown> | null): OrderRow | null {
  if (!row) return null;
  const o = { ...row } as Record<string, unknown>;
  for (const k of MONEY_KEYS) o[k] = Number(o[k]);
  return o as unknown as OrderRow;
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`, res.error.code ?? null);
  return res.data;
}

/** Store backed by a service-role supabase-js client. */
export function createStore(db: SupabaseClient): Store {
  const orderBy = async (col: string, value: string) =>
    toOrder(check(await db.from("orders").select(ORDER_COLUMNS).eq(col, value).maybeSingle(), `orders by ${col}`));

  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new DbError(error.message, error.code ?? null);
      return data as T;
    },

    async checkoutLive() {
      const row = check(
        await db.from("storefront_settings").select("checkout_live").eq("id", 1).maybeSingle(),
        "storefront_settings",
      );
      return row?.checkout_live === true;
    },

    async variants(ids) {
      if (ids.length === 0) return [];
      const rows = check(
        await db
          .from("productsizecolors")
          .select("variantid, productid, size, color, stock, products(name, retailprice, categoryid, categories(name))")
          .in("variantid", ids),
        "variants",
      ) as unknown as Record<string, unknown>[];
      return rows.map((r) => {
        const p = (r.products ?? {}) as Record<string, unknown>;
        const c = (p.categories ?? null) as Record<string, unknown> | null;
        return {
          variantId: String(r.variantid),
          productId: String(r.productid),
          name: String(p.name ?? ""),
          size: String(r.size ?? ""),
          color: String(r.color ?? ""),
          stock: Number(r.stock ?? 0),
          retailPrice: Number(p.retailprice),
          categoryId: p.categoryid == null ? null : String(p.categoryid),
          categoryName: c?.name == null ? null : String(c.name),
        };
      });
    },

    async creditBalance(authUserId) {
      const row = check(
        await db.from("customers").select("store_credit").eq("auth_user_id", authUserId).maybeSingle(),
        "customers credit",
      );
      if (!row) return null;
      return Math.round(Number(row.store_credit ?? 0) * 100) / 100;
    },

    orderByRef: (ref) => orderBy("order_ref", ref),
    orderByAttemptKey: (key) => orderBy("attempt_key", key),
    orderById: (id) => orderBy("id", id),

    async orderItems(orderId) {
      const rows = check(
        await db
          .from("order_items")
          .select("id, line_no, product_name, size, color, qty, unit_price, paid_value, status, refunded_qty")
          .eq("order_id", orderId)
          .order("line_no"),
        "order_items",
      ) as unknown as Record<string, unknown>[];
      return rows.map((r) => ({
        ...r,
        qty: Number(r.qty),
        unit_price: Number(r.unit_price),
        paid_value: Number(r.paid_value),
        refunded_qty: Number(r.refunded_qty),
      })) as unknown as OrderItemRow[];
    },

    async voucherValue(code) {
      const row = check(await db.from("vouchers").select("value").eq("voucher_id", code).maybeSingle(), "voucher");
      return row ? Number(row.value) : null;
    },

    async setAccessTokenHash(orderId, hash) {
      check(
        await db.from("orders").update({ access_token_hash: hash, updated_at: new Date().toISOString() }).eq(
          "id",
          orderId,
        ),
        "rotate access token",
      );
    },

    async recentStatusFailures(key) {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const res = await db
        .from("code_attempts")
        .select("id", { count: "exact", head: true })
        .eq("scope", "lookup")
        .eq("key", key)
        .eq("success", false)
        .gt("created_at", since);
      if (res.error) throw new DbError(`code_attempts count: ${res.error.message}`, res.error.code ?? null);
      return res.count ?? 0;
    },

    async recordStatusFailure(key) {
      check(await db.from("code_attempts").insert({ scope: "lookup", key, success: false }), "code_attempts insert");
    },
  };
}

/** Shiprocket bearer cache in integration_tokens (service role only). */
export function dbTokenStore(db: SupabaseClient, provider = "shiprocket"): TokenStore {
  return {
    async get() {
      const row = check(
        await db.from("integration_tokens").select("token, expires_at").eq("provider", provider).maybeSingle(),
        "integration_tokens",
      );
      if (!row?.token || !row.expires_at) return null;
      return { token: String(row.token), expiresAt: new Date(String(row.expires_at)) };
    },
    async set(token, expiresAt) {
      check(
        await db.from("integration_tokens").upsert({
          provider,
          token,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        }),
        "integration_tokens upsert",
      );
    },
  };
}

// ---------------------------------------------------------------- env + deps

export type AppEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  anonKey: string;
  allowedOrigins: string[];
  siteUrl: string;
  /** Salt for R9 IP hashing; empty disables IP-keyed limits (warned at startup). */
  ipHashSalt: string;
  /** Empty disables the x-cron-secret path of run-jobs. */
  cronSecret: string;
  cashfreeMode: CashfreeEnv;
  /** Shop inbox for new-order alerts (GMAIL_USER). */
  shopEmail: string;
};

export type AppDeps = {
  store: Store;
  cashfree: CashfreeClient | null;
  shiprocket: ShiprocketClient | null;
  verifyJwt: VerifyJwt;
  env: AppEnv;
  now: () => Date;
  /** Fire-and-forget POST to run-jobs (R2: drain the outbox right after a confirm). */
  kickJobs: () => void;
};

type EnvGet = (name: string) => string | undefined;

export function readEnv(get: EnvGet = (n) => Deno.env.get(n)): AppEnv {
  const required = (name: string) => {
    const v = get(name)?.trim();
    if (!v) throw new Error(`${name} is not set`);
    return v;
  };
  const mode = (get("CASHFREE_ENV")?.trim() || "sandbox") as CashfreeEnv;
  if (mode !== "sandbox" && mode !== "production") throw new Error(`CASHFREE_ENV must be sandbox|production`);
  return {
    supabaseUrl: required("SUPABASE_URL").replace(/\/+$/, ""),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
    anonKey: get("SUPABASE_ANON_KEY")?.trim() ?? "",
    allowedOrigins: parseAllowedOrigins(get("ALLOWED_ORIGIN")),
    siteUrl: (get("SITE_URL")?.trim() || "https://www.bindalscreations.com").replace(/\/+$/, ""),
    ipHashSalt: get("IP_HASH_SALT")?.trim() ?? "",
    cronSecret: get("CRON_SECRET")?.trim() ?? "",
    cashfreeMode: mode,
    shopEmail: get("GMAIL_USER")?.trim() ?? "",
  };
}

export function serviceDb(env: AppEnv): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function cashfreeFromEnv(get: EnvGet, mode: CashfreeEnv, fetchFn: typeof fetch = fetch): CashfreeClient | null {
  const clientId = get("CASHFREE_CLIENT_ID")?.trim();
  const clientSecret = get("CASHFREE_CLIENT_SECRET")?.trim();
  if (!clientId || !clientSecret) return null;
  return createCashfree({ clientId, clientSecret, env: mode, fetch: fetchFn });
}

export function shiprocketFromEnv(get: EnvGet, tokenStore: TokenStore, fetchFn: typeof fetch = fetch): ShiprocketClient | null {
  const email = get("SHIPROCKET_API_EMAIL")?.trim();
  const password = get("SHIPROCKET_API_PASSWORD")?.trim();
  if (!email || !password) return null;
  return createShiprocket({ email, password, fetch: fetchFn, tokenStore });
}

type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void };

/** Keeps a background promise alive past the response on Supabase Edge. */
export function runInBackground(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  rt?.waitUntil(p);
}

export function jobKicker(env: AppEnv, fetchFn: typeof fetch = fetch): () => void {
  return () => {
    const p = fetchFn(`${env.supabaseUrl}/functions/v1/run-jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.serviceRoleKey}`, "content-type": "application/json" },
      body: "{}",
    }).then(async (res) => {
      await res.body?.cancel();
      if (!res.ok) logEvent("warn", "kick_jobs_failed", { status: res.status });
    }).catch((err) => logEvent("warn", "kick_jobs_failed", { error: errorMessage(err) }));
    runInBackground(p);
  };
}

/** Real dependencies from the function's environment (index.ts only). */
export function appDeps(get: EnvGet = (n) => Deno.env.get(n)): AppDeps & { db: SupabaseClient; mailer: Mailer } {
  const env = readEnv(get);
  if (!env.ipHashSalt) logEvent("warn", "ip_hash_salt_missing", { effect: "IP rate limits disabled" });
  const db = serviceDb(env);
  return {
    db,
    store: createStore(db),
    cashfree: cashfreeFromEnv(get, env.cashfreeMode),
    shiprocket: shiprocketFromEnv(get, dbTokenStore(db)),
    mailer: createMailer({ user: get("GMAIL_USER"), appPassword: get("GMAIL_APP_PASSWORD") }),
    verifyJwt: supabaseVerifier(db),
    env,
    now: () => new Date(),
    kickJobs: jobKicker(env),
  };
}

/** JobContext for run-jobs handlers (shape fixed by jobs/types.ts). */
export function jobContext(deps: AppDeps & { db: SupabaseClient; mailer: Mailer }): JobContext {
  return {
    db: deps.db,
    cashfree: deps.cashfree,
    shiprocket: deps.shiprocket,
    mailer: deps.mailer,
    env: { siteUrl: deps.env.siteUrl, shopEmail: deps.env.shopEmail },
  };
}
