/**
 * POST admin-order-action (admin JWT). Contract:
 * docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md § admin-order-action.
 *
 *   set_availability {orderId, itemId, availableQty}
 *   process          {orderId, opKey}            claim → prepare → Shiprocket steps → packed (ship orders only)
 *   dispatch_manual  {orderId, trackingUrl?}     Porter, booked by hand: paid ship order (shelf checked) → shipped | cancelled
 *   mark_ready       {orderId}                   store pickup: paid (shelf checked) → ready_for_pickup | cancelled
 *   mark_collected   {orderId}                   store pickup: ready_for_pickup → delivered
 *   cancel           {orderId, opKey, reason}    paid, or ready_for_pickup (store pickup)
 *   retry            {orderId}                   re-run failed jobs / resume Process
 *   send_back        {orderId, opKey, manualCancelConfirmed?}                  stalled Process → paid
 *   rebook           {orderId, opKey, parcelLost, note, manualCancelConfirmed?} packed/shipped → paid | cancelled
 *   release_op       {orderId, opKey}            abandon a send_back / rebook whose booking was not cancelled
 *   rto_received     {orderId}
 *   mark_delivered   {orderId, deliveredAt, reason}   superadmin only; any admin for a Porter order (reason optional)
 *   return_open      {orderId, reason, contactedAt, items, note, returnAwb?, overrideReason?}
 *   return_photo_url {returnId, contentType}  →  {uploadUrl, path, token}
 *   return_photo_add {returnId, path}
 *   return_photo_view {photoId}               →  {url} (10 min)
 *   return_preview   {returnId, items}        →  {preview}
 *   return_receive   {returnId, items, note?}
 *   return_cancel    {returnId, note}
 *   set_live         {live}                      superadmin only
 *
 * 200 {ok: true, order, refundId?, billId?}; errors {error, code}: 409 busy | bad_state,
 * 502 courier_error (order left in processing with process_error; Retry resumes; for
 * send_back / rebook: courier booking not cancelled, order stays claimed, same opKey resumes),
 * 403 when manualCancelConfirmed comes from a non-superadmin.
 */

import {
  corsHeaders,
  handlePreflight,
  HttpError,
  json,
  parseAllowedOrigins,
  profileAdminCheck,
  requireAdmin,
  serviceClient,
  supabaseVerifier,
  type VerifyJwt,
} from "../_shared/http.ts";
import {
  DbError,
  logEvent,
  type OrdersDb,
  runCancel,
  runDispatchManual,
  runProcess,
  runRebook,
  runRetry,
  runSendBack,
  type ShipDeps,
  shiprocketFromEnv,
  supabaseOrdersDb,
} from "../_shared/process.ts";
import {
  isoTimestamp,
  mapOpenReturn,
  mapReceiveItems,
  optionalText,
  PHOTO_VIEW_TTL_SECONDS,
  photoExtFor,
  requiredText,
  type ReturnsStorage,
  supabaseReturnsStorage,
  UUID_RE,
} from "../_shared/returns.ts";
import type { ShiprocketClient } from "../_shared/shiprocket.ts";

export type Deps = {
  db: OrdersDb;
  shiprocket: ShiprocketClient;
  shopEmail: string;
  verifyJwt: VerifyJwt;
  isAdmin: (userId: string) => Promise<boolean>;
  isSuperadmin: (userId: string) => Promise<boolean>;
  storage: ReturnsStorage;
  /** anon/publishable keys: a bearer equal to one of these is "not signed in". */
  publicKeys: string[];
  allowedOrigins: string[];
  now?: () => Date;
  /** REBOOK_API_CANCEL === "on": cancel-by-AWB API allowed; otherwise a superadmin confirms a dashboard cancel. */
  rebookApiCancel?: boolean;
};

class BadRequest extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

class NotFound extends Error {}

function uuidField(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new BadRequest(`${key} must be a uuid`);
  return v;
}

function boolField(body: Record<string, unknown>, key: string, optional = false): boolean {
  const v = body[key];
  if (optional && v === undefined) return false;
  if (typeof v !== "boolean") throw new BadRequest(`${key} must be true or false`);
  return v;
}

/** Max length of a pasted courier tracking link (matches the orders column check). */
const TRACKING_URL_MAX = 500;

/** Optional https:// link shown to the shopper; blank → null. */
function trackingUrlField(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new BadRequest(`${key} must be text`);
  const url = v.trim();
  if (!url) return null;
  const parsed = URL.canParse(url) ? new URL(url) : null;
  if (!parsed || parsed.protocol !== "https:" || /\s/.test(url) || url.length > TRACKING_URL_MAX) {
    throw new BadRequest(`${key} must be an https:// link`);
  }
  return url;
}

function textField(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || !v.trim()) throw new BadRequest(`${key} is required`);
  return v.trim();
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const preflight = handlePreflight(req, deps.allowedOrigins);
  if (preflight) return preflight;
  const cors = corsHeaders(req, deps.allowedOrigins);
  const fail = (status: number, code: string, error: string) => json(status, { error, code }, cors);
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only");

  try {
    const user = await requireAdmin(req, deps.verifyJwt, deps.isAdmin, deps.publicKeys);
    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      throw new BadRequest("body must be a JSON object");
    }

    const ship: ShipDeps = { db: deps.db, shiprocket: deps.shiprocket, shopEmail: deps.shopEmail };
    const action = body.action;
    const orderBody = async (orderId: string, extra: Record<string, unknown> = {}) =>
      json(200, { ok: true, order: await deps.db.getOrderWithReturns(orderId), ...extra }, cors);

    const orderIdOfReturn = async (returnId: string) => {
      const id = await deps.db.getReturnOrderId(returnId);
      if (!id) throw new NotFound("return not found");
      return id;
    };

    switch (action) {
      case "set_availability": {
        const orderId = uuidField(body, "orderId");
        const itemId = uuidField(body, "itemId");
        const qty = body.availableQty;
        if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 0) {
          throw new BadRequest("availableQty must be a non-negative integer");
        }
        await deps.db.rpc("online_order_set_availability", {
          p_order_id: orderId,
          p_item_id: itemId,
          p_available_qty: qty,
          p_actor: user.id,
        });
        return await orderBody(orderId);
      }

      case "process": {
        const orderId = uuidField(body, "orderId");
        // The DB claim refuses pickup too; this gives staff a clearer reason than "order is paid".
        if ((await deps.db.getOrder(orderId))?.fulfilment === "pickup") {
          return fail(409, "bad_state", "store pickup orders are not shipped: use Ready for pickup");
        }
        const r = await runProcess(ship, orderId, user.id, textField(body, "opKey"));
        if (r.kind === "busy") return fail(409, "busy", "another staff action holds this order");
        if (r.kind === "bad_state") return fail(409, "bad_state", `order is ${r.status}`);
        if (r.kind === "courier_error") return fail(502, "courier_error", r.message);
        if (r.kind === "cancelled") return await orderBody(orderId, { refundId: r.refundId });
        return await orderBody(orderId, { billId: r.billId, ...(r.refundId ? { refundId: r.refundId } : {}) });
      }

      case "dispatch_manual": {
        // One transaction in Postgres (the Porter booking is outside our system), so no op key:
        // a repeat returns the stored result.
        const orderId = uuidField(body, "orderId");
        const r = await runDispatchManual(ship, orderId, user.id, trackingUrlField(body, "trackingUrl"));
        return await orderBody(orderId, {
          ...(r.billId ? { billId: r.billId } : {}),
          ...(r.refundId ? { refundId: r.refundId } : {}),
        });
      }

      case "mark_ready": {
        // One transaction in Postgres (no courier call), so no op key: a repeat returns the stored result.
        const orderId = uuidField(body, "orderId");
        const r = await deps.db.rpc<{ status: string; bill_id: number | null; refund_id: string | null }>(
          "online_order_mark_ready",
          { p_order_id: orderId, p_actor: user.id },
        );
        return await orderBody(orderId, {
          ...(r.bill_id ? { billId: r.bill_id } : {}),
          ...(r.refund_id ? { refundId: r.refund_id } : {}),
        });
      }

      case "mark_collected": {
        const orderId = uuidField(body, "orderId");
        await deps.db.rpc("online_order_mark_collected", { p_order_id: orderId, p_actor: user.id });
        return await orderBody(orderId);
      }

      case "cancel": {
        const orderId = uuidField(body, "orderId");
        const opKey = textField(body, "opKey");
        const reason = textField(body, "reason");
        const r = await runCancel(ship, orderId, user.id, opKey, reason);
        if (r.kind === "busy") return fail(409, "busy", "another staff action holds this order");
        // Already cancelled (e.g. by a rebook that refunded everything): nothing to do.
        if (r.kind === "bad_state" && r.status === "cancelled") return await orderBody(orderId);
        if (r.kind === "bad_state") return fail(409, "bad_state", `order is ${r.status}`);
        return await orderBody(orderId, { refundId: r.refundId });
      }

      case "send_back":
      case "rebook": {
        const orderId = uuidField(body, "orderId");
        const opKey = textField(body, "opKey");
        const rebook = action === "rebook"
          ? { parcelLost: boolField(body, "parcelLost"), note: textField(body, "note") }
          : null;
        const manual = boolField(body, "manualCancelConfirmed", true);
        if (manual && !(await deps.isSuperadmin(user.id))) {
          throw new HttpError(403, "superadmin access required to confirm a manual courier cancel");
        }
        const apiCancel = deps.rebookApiCancel ?? false;
        const r = rebook
          ? await runRebook(ship, orderId, user.id, opKey, rebook.parcelLost, rebook.note, manual, apiCancel)
          : await runSendBack(ship, orderId, user.id, opKey, manual, apiCancel);
        if (r.kind === "busy") return fail(409, "busy", "another staff action holds this order");
        if (r.kind === "bad_state") return fail(409, "bad_state", `order is ${r.status}`);
        if (r.kind === "cancel_failed") return fail(502, "courier_error", r.problem);
        return await orderBody(orderId, r.refundId ? { refundId: r.refundId } : {});
      }

      case "release_op": {
        // Refusals (booking already cancelled, live lease held by another key) raise → 409 bad_state.
        const orderId = uuidField(body, "orderId");
        await deps.db.rpc("online_order_release_op", {
          p_order_id: orderId,
          p_actor: user.id,
          p_op_key: textField(body, "opKey"),
        });
        return await orderBody(orderId);
      }

      case "retry": {
        const orderId = uuidField(body, "orderId");
        const r = await runRetry(ship, orderId, user.id, deps.now ?? (() => new Date()));
        if (r.kind === "not_found") return fail(404, "not_found", "order not found");
        if (r.kind === "busy") return fail(409, "busy", "another staff action holds this order");
        if (r.kind === "bad_state") return fail(409, "bad_state", `order is ${r.status}`);
        if (r.kind === "courier_error") return fail(502, "courier_error", r.message);
        if (r.kind === "packed") {
          return await orderBody(orderId, { billId: r.billId, ...(r.refundId ? { refundId: r.refundId } : {}) });
        }
        if (r.kind === "cancelled") return await orderBody(orderId, { refundId: r.refundId });
        return await orderBody(orderId);
      }

      case "rto_received": {
        const orderId = uuidField(body, "orderId");
        const refundId = await deps.db.rpc<string | null>("online_order_rto_received", {
          p_order_id: orderId,
          p_actor: user.id,
        });
        return await orderBody(orderId, { refundId });
      }

      case "mark_delivered": {
        const orderId = uuidField(body, "orderId");
        // No courier webhook ever delivers a Porter order, so any admin closes it. For Shiprocket
        // orders a manual delivery overrides tracking: superadmin only, reason required.
        const porter = (await deps.db.getOrder(orderId))?.courier === "porter";
        if (!porter && !(await deps.isSuperadmin(user.id))) {
          throw new HttpError(403, "superadmin access required");
        }
        await deps.db.rpc("online_order_mark_delivered", {
          p_order_id: orderId,
          p_actor: user.id,
          p_delivered_at: isoTimestamp(body.deliveredAt, "deliveredAt"),
          p_reason: porter ? optionalText(body.reason, "reason") : textField(body, "reason"),
        });
        return await orderBody(orderId);
      }

      case "return_open": {
        const orderId = uuidField(body, "orderId");
        const args = mapOpenReturn(
          body,
          orderId,
          user.id,
          await deps.isSuperadmin(user.id),
        );
        const returnId = await deps.db.rpc<string>("online_return_open", args);
        return await orderBody(orderId, { returnId });
      }

      case "return_photo_url": {
        // Only returnId and contentType are read: the path is always built by the DB.
        const returnId = uuidField(body, "returnId");
        const ext = photoExtFor(body.contentType);
        const path = await deps.db.rpc<string>("online_return_photo_path", {
          p_return_id: returnId,
          p_ext: ext,
        });
        const { uploadUrl, token } = await deps.storage.createUploadUrl(path);
        return json(200, { ok: true, uploadUrl, path, token }, cors);
      }

      case "return_photo_add": {
        const returnId = uuidField(body, "returnId");
        const path = textField(body, "path");
        const orderId = await orderIdOfReturn(returnId);
        const photoId = await deps.db.rpc<string>("online_return_add_photo", {
          p_return_id: returnId,
          p_path: path,
          p_actor: user.id,
        });
        return await orderBody(orderId, { photoId });
      }

      case "return_photo_view": {
        const path = await deps.db.getReturnPhotoPath(
          uuidField(body, "photoId"),
        );
        if (!path) return fail(404, "not_found", "photo not found");
        const url = await deps.storage.createViewUrl(path, PHOTO_VIEW_TTL_SECONDS);
        if (!url) return fail(404, "not_found", "photo file not found");
        return json(200, { ok: true, url }, cors);
      }

      case "return_preview": {
        const preview = await deps.db.rpc<Record<string, unknown>>(
          "online_return_preview",
          {
            p_return_id: uuidField(body, "returnId"),
            p_items: mapReceiveItems(body.items),
          },
        );
        return json(200, { ok: true, preview }, cors);
      }

      case "return_receive": {
        const returnId = uuidField(body, "returnId");
        const items = mapReceiveItems(body.items);
        const orderId = await orderIdOfReturn(returnId);
        const r = await deps.db.rpc<
          { status: string; refund_id: string | null; refund: unknown }
        >(
          "online_return_receive",
          {
            p_return_id: returnId,
            p_actor: user.id,
            p_items: items,
            p_note: optionalText(body.note, "note"),
          },
        );
        return await orderBody(orderId, {
          status: r.status,
          refund: r.refund,
          ...(r.refund_id ? { refundId: r.refund_id } : {}),
        });
      }

      case "return_cancel": {
        const returnId = uuidField(body, "returnId");
        const note = requiredText(body.note, "note");
        const orderId = await orderIdOfReturn(returnId);
        await deps.db.rpc("online_return_cancel", {
          p_return_id: returnId,
          p_actor: user.id,
          p_note: note,
        });
        return await orderBody(orderId);
      }

      case "set_live": {
        if (typeof body.live !== "boolean") throw new BadRequest("live must be true or false");
        if (!(await deps.isSuperadmin(user.id))) throw new HttpError(403, "superadmin access required");
        const r = await deps.db.rpc<{ checkout_live: boolean }>("online_set_checkout_live", {
          p_live: body.live,
          p_actor: user.id,
        });
        logEvent("info", "checkout_live_set", { actor: user.id, live: r.checkout_live });
        return json(200, { ok: true, order: null, live: r.checkout_live }, cors);
      }

      default:
        throw new BadRequest("unknown action");
    }
  } catch (err) {
    if (err instanceof NotFound) return fail(404, "not_found", err.message);
    if (err instanceof HttpError) {
      const code = err.status === 400 ? "invalid_request" : err.status === 401 ? "unauthorized" : "forbidden";
      return fail(err.status, code, err.message);
    }
    if (err instanceof DbError && err.isRaised) return fail(409, "bad_state", err.message);
    // Only return_photo_add inserts a client-supplied unique value: a replayed path.
    if (err instanceof DbError && err.isUniqueViolation && err.fn === "online_return_add_photo") {
      return fail(409, "bad_state", "photo already recorded");
    }
    logEvent("error", "admin_order_action_failed", { error: err instanceof Error ? err.message : String(err) });
    return fail(500, "internal", "internal error");
  }
}

if (import.meta.main) {
  const client = serviceClient();
  const isSuperadmin = async (userId: string) => {
    const { data, error } = await client.from("profiles").select("role, is_active").eq("id", userId).maybeSingle();
    if (error) throw new Error(`profiles lookup failed: ${error.message}`);
    return !!data && data.role === "superadmin" && data.is_active !== false;
  };
  const deps: Deps = {
    db: supabaseOrdersDb(client),
    shiprocket: shiprocketFromEnv(client),
    shopEmail: Deno.env.get("GMAIL_USER") ?? "",
    verifyJwt: supabaseVerifier(client),
    isAdmin: profileAdminCheck(client),
    isSuperadmin,
    storage: supabaseReturnsStorage(client),
    publicKeys: [Deno.env.get("SUPABASE_ANON_KEY"), Deno.env.get("SUPABASE_PUBLISHABLE_KEY")]
      .filter((k): k is string => !!k),
    allowedOrigins: parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGIN")),
    rebookApiCancel: Deno.env.get("REBOOK_API_CANCEL") === "on",
  };
  Deno.serve((req) => handler(req, deps));
}
