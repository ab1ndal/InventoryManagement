/**
 * Shiprocket side of an online order: create on payment, Process (R3), Cancel, Retry,
 * Send back (stalled Process → paid) and Rebook (packed/shipped → paid or cancelled).
 * Plan: Tasks 7–8, R3 (claim + checkpoints), R14, R15, R17, R19.
 *
 * Postgres owns every state change; this module only sequences external calls and
 * records each success with online_order_checkpoint right after it happens, so a
 * failed Process resumes from the first step whose checkpoint is missing and never
 * repeats a Shiprocket call that already succeeded.
 *
 * Process order (Shiprocket notes §6): [create] → [update if the shippable set
 * shrank] → assign AWB → pickup → manifest → label → online_order_mark_packed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { dbTokenStore } from "./context.ts";
import {
  type AwbResult,
  createShiprocket,
  type ShiprocketClient,
  ShiprocketError,
  type SrOrderInput,
} from "./shiprocket.ts";
import { parcelPackage, parcelWeightKg } from "./shipping.ts";

const DEFAULT_STATE = "Uttar Pradesh";
/** Error text stored on the order (sr_last_error, process_error) is capped. */
const ERROR_TEXT_MAX = 500;

// ---------- logging ----------

export function logEvent(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, ERROR_TEXT_MAX);
}

// ---------- DB port ----------

export type ProcessPlanItem = {
  item_id: string;
  units: number;
  paid_value: number;
  name?: string;
  size?: string | null;
  color?: string | null;
};

export type ProcessPlan = {
  shippable_items: ProcessPlanItem[];
  all_unavailable: boolean;
  refund_id: string | null;
};

/** The orders columns this module reads (the row has more). */
export type OrderRow = {
  id: string;
  order_ref: string;
  status: string;
  fulfilment: "ship" | "pickup";
  /** null = the default Shiprocket flow; "porter" once dispatched by hand. */
  courier: "shiprocket" | "porter" | null;
  manual_tracking_url: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
  address: Record<string, unknown> | null;
  created_at: string;
  paid_at: string | null;
  quoted_courier_id: number | null;
  sr_order_id: string | null;
  sr_shipment_id: string | null;
  sr_updated_at: string | null;
  awb: string | null;
  courier_id: number | null;
  courier_name: string | null;
  pickup_requested_at: string | null;
  manifest_url: string | null;
  label_url: string | null;
  bill_id: number | null;
  op_key: string | null;
  op_action: string | null;
  op_lease_until: string | null;
  process_error: string | null;
  sr_attempt: number;
  /** Only present on getOrderWithReturns. */
  returns?: Record<string, unknown>[];
  [column: string]: unknown;
};

export type OrderItemRow = {
  id: string;
  line_no: number;
  productid: string;
  product_name: string;
  size: string | null;
  color: string | null;
  category_id: string | null;
  category_name: string | null;
  qty: number;
  paid_value: number | string;
  stock_taken: number;
  refunded_qty: number;
};

export class DbError extends Error {
  constructor(readonly fn: string, readonly code: string | null, message: string) {
    super(`${fn}: ${message}`);
    this.name = "DbError";
  }
  /** A `raise exception` inside our plpgsql functions (business rule refused). */
  get isRaised(): boolean {
    return this.code === "P0001";
  }
  get isUniqueViolation(): boolean {
    return this.code === "23505";
  }
}

const byKey = (key: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(a[key] ?? "").localeCompare(String(b[key] ?? ""));

/** Deterministic order for the embedded returns (PostgREST orders embeds by alias, so sort here). */
export function sortReturns(order: OrderRow): OrderRow {
  if (!order.returns) return order;
  const list = (v: unknown) => (Array.isArray(v) ? v as Record<string, unknown>[] : []);
  return {
    ...order,
    returns: [...order.returns].sort(byKey("opened_at")).map((r) => ({
      ...r,
      items: [...list(r.items)].sort(byKey("item_id")),
      photos: [...list(r.photos)].sort(byKey("uploaded_at")),
    })),
  };
}

export type OrdersDb = {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  getOrder(id: string): Promise<OrderRow | null>;
  /** getOrder plus the order's returns (items, photo ids): only for staff responses, never internal reads. */
  getOrderWithReturns(id: string): Promise<OrderRow | null>;
  /** Stored storage path of a return photo; staff view it through a signed URL only. */
  getReturnPhotoPath(photoId: string): Promise<string | null>;
  getReturnOrderId(returnId: string): Promise<string | null>;
  getItems(orderId: string): Promise<OrderItemRow[]>;
};

export function supabaseOrdersDb(client: SupabaseClient): OrdersDb {
  return {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      const { data, error } = await client.rpc(fn, args);
      if (error) throw new DbError(fn, error.code ?? null, error.message);
      return data as T;
    },
    async getOrder(id) {
      const { data, error } = await client.from("orders").select("*").eq("id", id).maybeSingle();
      if (error) throw new DbError("orders", error.code ?? null, error.message);
      return (data ?? null) as OrderRow | null;
    },
    async getOrderWithReturns(id) {
      const { data, error } = await client.from("orders")
        .select("*, returns:order_returns(*, items:order_return_items(*), photos:order_return_photos(id, uploaded_at))")
        .eq("id", id).maybeSingle();
      if (error) throw new DbError("orders", error.code ?? null, error.message);
      return data ? sortReturns(data as OrderRow) : null;
    },
    async getReturnPhotoPath(photoId) {
      const { data, error } = await client.from("order_return_photos").select("path").eq("id", photoId).maybeSingle();
      if (error) throw new DbError("order_return_photos", error.code ?? null, error.message);
      return (data?.path as string | undefined) ?? null;
    },
    async getReturnOrderId(returnId) {
      const { data, error } = await client.from("order_returns").select("order_id").eq("id", returnId).maybeSingle();
      if (error) throw new DbError("order_returns", error.code ?? null, error.message);
      return (data?.order_id as string | undefined) ?? null;
    },
    async getItems(orderId) {
      const { data, error } = await client.from("order_items").select("*").eq("order_id", orderId).order("line_no");
      if (error) throw new DbError("order_items", error.code ?? null, error.message);
      return (data ?? []) as OrderItemRow[];
    },
  };
}

/** Real client from SHIPROCKET_API_EMAIL / SHIPROCKET_API_PASSWORD; missing secrets fail at first call. */
export function shiprocketFromEnv(client: SupabaseClient): ShiprocketClient {
  return createShiprocket({
    email: Deno.env.get("SHIPROCKET_API_EMAIL") ?? "",
    password: Deno.env.get("SHIPROCKET_API_PASSWORD") ?? "",
    fetch: (input, init) => fetch(input, init),
    tokenStore: dbTokenStore(client),
  });
}

// ---------- Shiprocket order payload ----------

/** A Shiprocket call failed; `step` is the checkpoint it would have written. */
export class CourierError extends Error {
  constructor(readonly step: string, message: string) {
    super(`${step}: ${message}`);
    this.name = "CourierError";
  }
}

async function ext<T>(step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    throw new CourierError(step, errorText(err));
  }
}

/**
 * Statuses where Shiprocket answered and refused the assignment, so no AWB exists yet.
 * A timeout (0), auth or 5xx failure might have assigned one: never re-assign after those.
 */
const AWB_REFUSED_STATUSES = new Set([200, 400, 422]);

/**
 * Quoted courier first. If Shiprocket refuses it (courier dropped the pincode, weight limit),
 * let Shiprocket pick its default so Retry doesn't hit the same refusal forever; that
 * courier's rate can differ from what the shopper paid. An empty wallet refuses both calls.
 */
async function assignAwb(
  sr: ShiprocketClient,
  shipmentId: number,
  quotedCourierId: number | null,
  orderRef: string,
): Promise<AwbResult> {
  if (quotedCourierId === null) return await sr.assignAwb(shipmentId);
  try {
    return await sr.assignAwb(shipmentId, quotedCourierId);
  } catch (err) {
    if (!(err instanceof ShiprocketError) || !AWB_REFUSED_STATUSES.has(err.status)) throw err;
    logEvent("warn", "awb_quoted_courier_refused", {
      order_ref: orderRef,
      courier_id: quotedCourierId,
      error: errorText(err),
    });
    return await sr.assignAwb(shipmentId);
  }
}

type SrLine = { item: OrderItemRow; units: number; value: number };

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Units that took stock and weren't refunded (stock-race units never shipped). */
export function createLines(items: OrderItemRow[]): SrLine[] {
  return items
    .map((item) => {
      const units = Math.max(0, Math.min(item.stock_taken, item.qty - item.refunded_qty));
      return { item, units, value: (Number(item.paid_value) * units) / item.qty };
    })
    .filter((l) => l.units > 0);
}

/** The plan's shippable units, valued at what they paid net of refunds. */
export function shippableLines(items: OrderItemRow[], plan: ProcessPlan): SrLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return plan.shippable_items
    .filter((s) => s.units > 0)
    .map((s) => {
      const item = byId.get(s.item_id);
      if (!item) throw new Error(`process plan item ${s.item_id} is not in the order`);
      return { item, units: s.units, value: Number(s.paid_value) };
    });
}

/** True when the plan ships a different unit set than the Shiprocket order was created with. */
export function shippableDiffers(items: OrderItemRow[], plan: ProcessPlan): boolean {
  const created = new Map(createLines(items).map((l) => [l.item.id, l.units]));
  const ship = new Map(plan.shippable_items.filter((s) => s.units > 0).map((s) => [s.item_id, s.units]));
  if (created.size !== ship.size) return true;
  for (const [id, units] of ship) if (created.get(id) !== units) return true;
  return false;
}

/** Shiprocket order id: Shiprocket never reuses cancelled ids, so attempt n >= 2 gets `-n`. */
export function srOrderRef(o: OrderRow): string {
  const attempt = o.sr_attempt ?? 1;
  return attempt > 1 ? `${o.order_ref}-${attempt}` : o.order_ref;
}

export function buildSrInput(o: OrderRow, lines: SrLine[]): SrOrderInput {
  const a = (o.address ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
  const items = lines.map(({ item, units, value }) => ({
    name: [item.product_name, item.size, item.color].filter(Boolean).join(" / "),
    sku: [item.productid, item.size, item.color].filter(Boolean).join("-"),
    units,
    sellingPrice: round2(value / units),
  }));
  const categories = lines.flatMap(({ item, units }) =>
    Array.from({ length: units }, () => item.category_name ?? item.category_id)
  );
  // Shiprocket adhoc has no landmark field; it rides on address_2 so the courier sees it.
  const landmark = str(a.landmark);
  const address2 = [str(a.line2), landmark ? `Landmark: ${landmark}` : ""].filter(Boolean).join(", ");
  return {
    orderRef: srOrderRef(o),
    orderDate: new Date(o.paid_at ?? o.created_at),
    billing: {
      name: o.contact_name,
      address: str(a.line1),
      ...(address2 ? { address2 } : {}),
      city: str(a.city),
      pincode: str(a.pincode),
      state: str(a.state) || DEFAULT_STATE,
      // Shiprocket wants the 10-digit Indian number; we store +91XXXXXXXXXX.
      phone: o.contact_phone.replace(/\D/g, "").slice(-10),
      email: o.contact_email,
    },
    items,
    subTotal: round2(items.reduce((s, i) => s + i.sellingPrice * i.units, 0)),
    ...parcelPackage(categories),
    weightKg: parcelWeightKg(categories),
  };
}

// ---------- create (job + inline) ----------

export type ShipDeps = {
  db: OrdersDb;
  shiprocket: ShiprocketClient;
  /** R17 billing_email fallback (GMAIL_USER). */
  shopEmail: string;
};

export type EnsureResult = "exists" | "created" | "skipped";

async function mustGetOrder(db: OrdersDb, orderId: string): Promise<OrderRow> {
  const o = await db.getOrder(orderId);
  if (!o) throw new Error(`order ${orderId} not found`);
  return o;
}

/**
 * Creates the Shiprocket order once. Skips when sr_order_id is stored, when the order
 * is a store pickup (Retry calls this for any paid order without one) or went with
 * Porter, or when the order is no longer shippable (cancelled before the job ran). A Shiprocket failure
 * is recorded as sr_create_failed and rethrown as CourierError so the job retries.
 * `opKey` (Process running it inline) fences the checkpoints; the job passes none.
 */
export async function ensureSrOrder(deps: ShipDeps, orderId: string, opKey?: string): Promise<EnsureResult> {
  const fence = opKey ? { p_op_key: opKey } : {};
  const o = await mustGetOrder(deps.db, orderId);
  if (o.sr_order_id) return "exists";
  if (o.fulfilment === "pickup") {
    logEvent("info", "sr_create_skipped", { order_ref: o.order_ref, reason: "store pickup" });
    return "skipped";
  }
  if (o.courier === "porter") {
    logEvent("info", "sr_create_skipped", { order_ref: o.order_ref, reason: "porter" });
    return "skipped";
  }
  if (o.status !== "paid" && o.status !== "processing") {
    logEvent("info", "sr_create_skipped", { order_ref: o.order_ref, status: o.status });
    return "skipped";
  }
  const lines = createLines(await deps.db.getItems(orderId));
  if (lines.length === 0) {
    logEvent("info", "sr_create_skipped", { order_ref: o.order_ref, reason: "no units took stock" });
    return "skipped";
  }
  let ids;
  try {
    ids = await deps.shiprocket.createOrder(buildSrInput(o, lines), deps.shopEmail);
  } catch (err) {
    const error = errorText(err);
    await deps.db.rpc("online_order_checkpoint", {
      p_order_id: orderId,
      p_step: "sr_create_failed",
      p_data: { error },
      ...fence,
    });
    logEvent("warn", "sr_create_failed", { order_ref: o.order_ref, error });
    throw new CourierError("sr_create", error);
  }
  await deps.db.rpc("online_order_checkpoint", {
    p_order_id: orderId,
    p_step: "sr_create",
    p_data: { sr_order_id: String(ids.srOrderId), sr_shipment_id: String(ids.shipmentId) },
    ...fence,
  });
  logEvent("info", "sr_created", { order_ref: o.order_ref, sr_order_id: ids.srOrderId });
  return "created";
}

// ---------- claim ----------

type ClaimResult = {
  claimed: boolean;
  resumed: boolean;
  reason?: "busy" | "other_action" | "status";
  status: string;
  /** _order_ops_json: checkpoint columns, incl. sr_cancelled_op_key. */
  order?: { order_ref: string; awb: string | null; sr_order_id: string | null; sr_cancelled_op_key: string | null };
};

export type Refused = { kind: "busy" } | { kind: "bad_state"; status: string };

function refused(c: ClaimResult): Refused {
  return c.reason === "status" ? { kind: "bad_state", status: c.status } : { kind: "busy" };
}

/** Another operation (Send back) now owns the order; this worker must stop without writing. */
class OpSuperseded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpSuperseded";
  }
}

/** The DB fence refused a write because the order's op key changed. */
function isStaleOp(err: unknown): boolean {
  return err instanceof OpSuperseded ||
    (err instanceof DbError && err.isRaised && err.message.includes("stale operation"));
}

/**
 * Best effort: the original failure is what the caller reports. With the op key the
 * write is fenced; returns true when the fence refused it (another op owns the order).
 */
async function recordError(db: OrdersDb, orderId: string, err: unknown, opKey: string): Promise<boolean> {
  try {
    await db.rpc("online_order_checkpoint", {
      p_order_id: orderId,
      p_step: "error",
      p_data: { error: errorText(err) },
      p_op_key: opKey,
    });
    return false;
  } catch (cpErr) {
    if (isStaleOp(cpErr)) return true;
    logEvent("error", "checkpoint_error_failed", { order_id: orderId, error: errorText(cpErr), cause: errorText(err) });
    return false;
  }
}

function srIds(o: OrderRow): { srOrderId: number; shipmentId: number } {
  const srOrderId = Number(o.sr_order_id);
  const shipmentId = Number(o.sr_shipment_id);
  if (!Number.isFinite(srOrderId) || !Number.isFinite(shipmentId)) {
    throw new Error(`order ${o.order_ref} has no valid Shiprocket ids`);
  }
  return { srOrderId, shipmentId };
}

async function setProblem(db: OrdersDb, orderRef: string, problem: string): Promise<void> {
  await db.rpc("online_order_set_problem", { p_order_ref: orderRef, p_problem: problem });
  logEvent("warn", "order_problem", { order_ref: orderRef, problem });
}

// ---------- process ----------

export type ProcessOutcome =
  | { kind: "packed"; billId: number; refundId: string | null }
  | { kind: "cancelled"; refundId: string | null; problem: string | null }
  | { kind: "courier_error"; step: string; message: string }
  | Refused;

export async function runProcess(
  deps: ShipDeps,
  orderId: string,
  actor: string,
  opKey: string,
): Promise<ProcessOutcome> {
  const { db, shiprocket: sr } = deps;
  const claim = await db.rpc<ClaimResult>("online_order_claim", {
    p_order_id: orderId,
    p_action: "process",
    p_actor: actor,
    p_op_key: opKey,
  });
  if (!claim.claimed) return refused(claim);

  const checkpoint = (step: string, data: Record<string, unknown>) =>
    db.rpc("online_order_checkpoint", { p_order_id: orderId, p_step: step, p_data: data, p_op_key: opKey });
  // An expired lease doesn't stop this worker, so renew it (same key) right before each
  // Shiprocket call; if Send back took the order over, stop before touching the courier.
  const renew = async (step: string): Promise<void> => {
    const renewal = await db.rpc<ClaimResult>("online_order_claim", {
      p_order_id: orderId,
      p_action: "process",
      p_actor: actor,
      p_op_key: opKey,
    });
    if (!renewal.claimed) throw new OpSuperseded(`lease renewal refused before ${step} (${renewal.reason})`);
  };
  const courier = async <T>(step: string, call: () => Promise<T>): Promise<T> => {
    await renew(step);
    return ext(step, call);
  };

  try {
    const plan = await db.rpc<ProcessPlan>("online_order_prepare_process", { p_order_id: orderId, p_actor: actor });
    let o = await mustGetOrder(db, orderId);

    if (plan.all_unavailable) {
      // The DB already cancelled the order and refunded everything incl. shipping.
      let problem: string | null = null;
      if (o.sr_order_id) {
        try {
          await sr.cancel([srIds(o).srOrderId]);
        } catch (err) {
          problem = `Shiprocket cancel failed (${errorText(err)}) — cancel the order in Shiprocket dashboard`;
          await setProblem(db, o.order_ref, problem);
        }
      }
      return { kind: "cancelled", refundId: plan.refund_id, problem };
    }

    if (!o.sr_order_id) {
      // shiprocket_create job hasn't succeeded yet: run it inline.
      await renew("sr_create");
      await ensureSrOrder(deps, orderId, opKey);
      o = await mustGetOrder(db, orderId);
    }
    const { srOrderId, shipmentId } = srIds(o);
    const items = await db.getItems(orderId);

    if (!o.sr_updated_at && shippableDiffers(items, plan)) {
      const ids = await courier(
        "sr_update",
        () => sr.updateOrder(buildSrInput(o, shippableLines(items, plan)), deps.shopEmail),
      );
      if (ids.shipmentId !== shipmentId) {
        // UNVERIFIED: update/adhoc is documented to keep the shipment; flag if it doesn't.
        logEvent("warn", "sr_update_shipment_changed", {
          order_ref: o.order_ref,
          before: shipmentId,
          after: ids.shipmentId,
        });
      }
      await checkpoint("sr_update", {});
    }

    let { awb, courier_id: courierId, courier_name: courierName, manifest_url: manifestUrl, label_url: labelUrl } = o;
    if (!awb) {
      const r = await courier("awb", () => assignAwb(sr, shipmentId, o.quoted_courier_id, o.order_ref));
      courierId = Number.isFinite(r.courierId) ? r.courierId : null;
      courierName = r.courierName || null;
      awb = r.awb;
      await checkpoint("awb", { awb, courier_id: courierId, courier_name: courierName });
    }
    if (!o.pickup_requested_at) {
      const p = await courier("pickup", () => sr.pickup(shipmentId));
      await checkpoint("pickup", { scheduled_date: p.scheduledDate, token_number: p.tokenNumber });
    }
    if (!manifestUrl) {
      manifestUrl = await courier("manifest", () => sr.manifest(shipmentId, srOrderId));
      await checkpoint("manifest", { manifest_url: manifestUrl });
    }
    if (!labelUrl) {
      labelUrl = await courier("label", () => sr.label(shipmentId));
      await checkpoint("label", { label_url: labelUrl });
    }

    const billId = await db.rpc<number>("online_order_mark_packed", {
      p_order_id: orderId,
      p_shipment: {
        awb,
        courier_id: courierId,
        courier_name: courierName,
        manifest_url: manifestUrl,
        label_url: labelUrl,
      },
      p_actor: actor,
      p_op_key: opKey,
    });
    logEvent("info", "order_packed", { order_ref: o.order_ref, awb, bill_id: billId });
    return { kind: "packed", billId, refundId: plan.refund_id };
  } catch (err) {
    // The order belongs to another op now: the fenced error checkpoint is refused too,
    // so the new op's lease and process_error stay untouched.
    if (isStaleOp(err) || await recordError(db, orderId, err, opKey)) {
      logEvent("warn", "process_superseded", { order_id: orderId, op_key: opKey, error: errorText(err) });
      return { kind: "busy" };
    }
    logEvent("warn", "process_failed", { order_id: orderId, error: errorText(err) });
    if (err instanceof CourierError) return { kind: "courier_error", step: err.step, message: err.message };
    throw err;
  }
}

// ---------- cancel ----------

export type CancelOutcome = { kind: "cancelled"; refundId: string | null; problem: string | null } | Refused;

export async function runCancel(
  deps: ShipDeps,
  orderId: string,
  actor: string,
  opKey: string,
  reason: string,
): Promise<CancelOutcome> {
  const { db } = deps;
  const claim = await db.rpc<ClaimResult>("online_order_claim", {
    p_order_id: orderId,
    p_action: "cancel",
    p_actor: actor,
    p_op_key: opKey,
  });
  if (!claim.claimed) return refused(claim);

  const before = await mustGetOrder(db, orderId);
  let refundId: string | null;
  try {
    refundId = await db.rpc<string | null>("online_order_cancel", {
      p_order_id: orderId,
      p_actor: actor,
      p_reason: reason,
    });
  } catch (err) {
    await recordError(db, orderId, err, opKey);
    throw err;
  }

  // Money first (done above); the Shiprocket side can't undo it.
  let problem: string | null = null;
  if (before.awb) {
    problem = `Cancel the AWB in Shiprocket dashboard (AWB ${before.awb})`;
  } else if (before.sr_order_id) {
    try {
      await deps.shiprocket.cancel([srIds(before).srOrderId]);
    } catch (err) {
      problem = `Shiprocket cancel failed (${errorText(err)}) — cancel the order in Shiprocket dashboard`;
    }
  }
  if (problem) await setProblem(db, before.order_ref, problem);
  return { kind: "cancelled", refundId, problem };
}

// ---------- dispatch by hand (Porter) ----------

type ManualDispatchResult = {
  status: string;
  bill_id: number | null;
  refund_id: string | null;
  all_unavailable: boolean;
  changed: boolean;
  /** The Shiprocket order made at payment; only on the call that dispatched (or cancelled). */
  sr_order_id: string | null;
};

export type ManualDispatchOutcome = {
  status: string;
  billId: number | null;
  refundId: string | null;
  problem: string | null;
};

/**
 * Porter, booked by staff in the Porter app: one DB transaction (shelf-check refunds, bill,
 * shipped), then a best-effort cancel of the Shiprocket order created at payment so nobody
 * books it by mistake. Shiprocket being down never blocks the dispatch: a failed cancel is
 * left on orders.problem for a dashboard cancel. A repeat (lost response) does not cancel
 * again; if the first response was lost before the cancel ran, the unbooked Shiprocket order
 * (no AWB, no cost) stays until someone cancels it in the dashboard.
 */
export async function runDispatchManual(
  deps: ShipDeps,
  orderId: string,
  actor: string,
  trackingUrl: string | null,
): Promise<ManualDispatchOutcome> {
  const { db } = deps;
  const r = await db.rpc<ManualDispatchResult>("online_order_dispatch_manual", {
    p_order_id: orderId,
    p_actor: actor,
    p_tracking_url: trackingUrl,
  });
  let problem: string | null = null;
  if (r.changed && r.sr_order_id) {
    try {
      const srOrderId = Number(r.sr_order_id);
      if (!Number.isFinite(srOrderId)) throw new Error(`invalid Shiprocket order id ${r.sr_order_id}`);
      await deps.shiprocket.cancel([srOrderId]);
      logEvent("info", "sr_cancelled_for_manual_dispatch", { order_id: orderId, sr_order_id: r.sr_order_id });
    } catch (err) {
      problem = `Shiprocket order ${r.sr_order_id} not cancelled (${errorText(err)}) — ` +
        "cancel it in Shiprocket dashboard";
      await setProblem(db, (await mustGetOrder(db, orderId)).order_ref, problem);
    }
  }
  logEvent("info", "order_dispatched_manual", { order_id: orderId, status: r.status, changed: r.changed });
  return { status: r.status, billId: r.bill_id, refundId: r.refund_id, problem };
}

// ---------- send back / rebook ----------

export type AdminOpOutcome =
  | { kind: "done"; status: string; refundId: string | null }
  | { kind: "cancel_failed"; problem: string }
  | Refused;

type FinalizeResult = { status: string; refund_id?: string | null };

/**
 * Send back and Rebook share one shape: claim → make sure the courier booking is
 * cancelled (once per op: the sr_cancelled checkpoint, or a superadmin's manual
 * confirmation) → finalize in Postgres. A failed or disallowed cancel stops with the
 * order still claimed, so the same op key resumes after the dashboard cancel.
 */
async function runResend(
  deps: ShipDeps,
  action: "send_back" | "rebook",
  orderId: string,
  actor: string,
  opKey: string,
  manualCancelConfirmed: boolean,
  apiCancel: boolean,
  finalize: () => Promise<FinalizeResult>,
): Promise<AdminOpOutcome> {
  const { db } = deps;
  const claim = await db.rpc<ClaimResult>("online_order_claim", {
    p_order_id: orderId,
    p_action: action,
    p_actor: actor,
    p_op_key: opKey,
  });
  if (!claim.claimed) {
    if (claim.reason !== "status") return refused(claim);
    // Lost response after finalizing: the finalize function returns its stored result
    // for the key that finalized, and refuses (stale operation) any other key.
    try {
      const r = await finalize();
      return { kind: "done", status: r.status, refundId: r.refund_id ?? null };
    } catch (err) {
      if (isStaleOp(err)) return refused(claim);
      throw err;
    }
  }

  const o = claim.order;
  if (!o) throw new Error(`online_order_claim(${action}) returned no order`);
  const { order_ref: orderRef } = o;
  if ((o.awb || o.sr_order_id) && o.sr_cancelled_op_key !== opKey) {
    if (manualCancelConfirmed) {
      await db.rpc("online_order_confirm_manual_cancel", { p_order_id: orderId, p_actor: actor, p_op_key: opKey });
      logEvent("info", "manual_cancel_confirmed", { order_ref: orderRef, action, op_key: opKey, awb: o.awb });
    } else if (o.awb && !apiCancel) {
      // Cancel-by-AWB is unverified against the live API (REBOOK_API_CANCEL off).
      const problem = `Courier booking AWB ${o.awb} must be cancelled in the Shiprocket dashboard; ` +
        "a superadmin then confirms it here.";
      await setProblem(db, orderRef, problem);
      return { kind: "cancel_failed", problem };
    } else {
      try {
        if (o.awb) await deps.shiprocket.cancelAwbs([o.awb]);
        else {
          const srOrderId = Number(o.sr_order_id);
          if (!Number.isFinite(srOrderId)) throw new Error(`invalid Shiprocket order id ${o.sr_order_id}`);
          await deps.shiprocket.cancel([srOrderId]);
        }
      } catch (err) {
        const problem = [o.awb && `Cancel AWB ${o.awb}`, o.sr_order_id && `Shiprocket order ${o.sr_order_id}`]
          .filter(Boolean).join(" / ") + " in Shiprocket dashboard";
        logEvent("warn", "sr_cancel_failed", {
          order_ref: orderRef,
          action,
          awb: o.awb,
          sr_order_id: o.sr_order_id,
          error: errorText(err),
        });
        await setProblem(db, orderRef, problem);
        return { kind: "cancel_failed", problem };
      }
      await db.rpc("online_order_checkpoint", {
        p_order_id: orderId,
        p_step: "sr_cancelled",
        p_data: { awb: o.awb, sr_order_id: o.sr_order_id },
        p_op_key: opKey,
      });
    }
  }

  const r = await finalize();
  logEvent("info", action === "send_back" ? "order_sent_back" : "order_rebooked", {
    order_ref: orderRef,
    op_key: opKey,
    status: r.status,
    old_awb: o.awb,
    old_sr_order_id: o.sr_order_id,
  });
  return { kind: "done", status: r.status, refundId: r.refund_id ?? null };
}

/** Stalled Process (expired lease) → order back to paid for a fresh Process. */
export function runSendBack(
  deps: ShipDeps,
  orderId: string,
  actor: string,
  opKey: string,
  manualCancelConfirmed: boolean,
  apiCancel: boolean,
): Promise<AdminOpOutcome> {
  return runResend(
    deps,
    "send_back",
    orderId,
    actor,
    opKey,
    manualCancelConfirmed,
    apiCancel,
    () =>
      deps.db.rpc<FinalizeResult>("online_order_send_back", {
        p_order_id: orderId,
        p_actor: actor,
        p_op_key: opKey,
      }),
  );
}

/** Packed / shipped / out for delivery → paid (re-send) or cancelled (nothing left, refunded). */
export function runRebook(
  deps: ShipDeps,
  orderId: string,
  actor: string,
  opKey: string,
  parcelLost: boolean,
  note: string,
  manualCancelConfirmed: boolean,
  apiCancel: boolean,
): Promise<AdminOpOutcome> {
  return runResend(
    deps,
    "rebook",
    orderId,
    actor,
    opKey,
    manualCancelConfirmed,
    apiCancel,
    () =>
      deps.db.rpc<FinalizeResult>("online_order_rebook", {
        p_order_id: orderId,
        p_actor: actor,
        p_op_key: opKey,
        p_parcel_lost: parcelLost,
        p_note: note,
      }),
  );
}

// ---------- retry ----------

export type RetryOutcome =
  | { kind: "not_found" }
  | (
    & { jobsReset: number }
    & (
      | { kind: "ok"; srCreated: EnsureResult | null }
      | ProcessOutcome
    )
  );

/**
 * Admin Retry: makes failed jobs due now, then resumes an interrupted Process with
 * its stored op key, or creates the missing Shiprocket order for a paid order.
 */
export async function runRetry(deps: ShipDeps, orderId: string, actor: string, now: () => Date): Promise<RetryOutcome> {
  const o = await deps.db.getOrder(orderId);
  if (!o) return { kind: "not_found" };
  const jobsReset = await deps.db.rpc<number>("online_job_retry", { p_order_id: orderId });

  if (o.status === "processing" && o.op_action === "process" && o.op_key) {
    // The same op key resumes even under a live lease, so only resume a stalled one.
    if (o.op_lease_until && Date.parse(o.op_lease_until) > now().getTime()) return { kind: "busy", jobsReset };
    return { jobsReset, ...(await runProcess(deps, orderId, actor, o.op_key)) };
  }
  if (o.status === "paid" && !o.sr_order_id) {
    try {
      return { kind: "ok", jobsReset, srCreated: await ensureSrOrder(deps, orderId) };
    } catch (err) {
      if (err instanceof CourierError) {
        return { kind: "courier_error", jobsReset, step: err.step, message: err.message };
      }
      throw err;
    }
  }
  return { kind: "ok", jobsReset, srCreated: null };
}
