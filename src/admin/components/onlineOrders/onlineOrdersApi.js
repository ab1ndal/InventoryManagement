// Data access for the admin Online Orders screen.
// Reads: direct selects under the admin RLS policies (schema/migration_online_orders.sql).
// Writes: only through the `admin-order-action` Edge Function
// (docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md).
import { supabase } from "../../../lib/supabaseClient";
import { normalizeOrderSearch } from "./orderHelpers";

export const LIST_LIMIT = 200;

export const DEFAULT_QUEUE = "needs_action";

// Porter and self delivery report nothing back, and a forgotten Delivered blocks the return window.
export const MANUAL_STALE_DAYS = 2;
const MANUAL_OPEN_STATUSES = ["processed", "packed", "shipped", "out_for_delivery"];

// Queue key → which orders it shows. needs_action has no status list: its filter needs lookups.
// An order may sit in both needs_action and in_progress.
export const ORDER_QUEUES = {
  needs_action: { label: "Needs action", counted: true },
  in_progress: {
    label: "In progress",
    counted: true,
    statuses: ["processing", "cancelling", "processed", "packed", "ready_for_pickup", "shipped", "out_for_delivery"],
  },
  closed: { label: "Closed", statuses: ["delivered", "cancelled", "rto_received"] },
};

const LIST_COLUMNS =
  "id, order_ref, created_at, status, contact_name, contact_phone, subtotal, promo_discount, " +
  "shipping, voucher_applied, credit_applied, gateway_amount, problem, process_error, address, fulfilment, courier, awb, " +
  "order_items(qty, shipped_qty), returns:order_returns(status, items:order_return_items(received_units))";

export class OrderActionError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "OrderActionError";
    this.status = status;
    this.code = code;
  }
}

function raise(what, error) {
  throw new Error(`${what}: ${error.message}`);
}

async function failedJobOrderIds() {
  const { data, error } = await supabase
    .from("order_jobs")
    .select("order_id")
    .eq("status", "failed");
  if (error) raise("Loading failed jobs", error);
  return [...new Set((data || []).map((j) => j.order_id))];
}

async function openReturnOrderIds() {
  const { data, error } = await supabase
    .from("order_returns")
    .select("order_id")
    .eq("status", "open");
  if (error) raise("Loading open returns", error);
  return [...new Set((data || []).map((r) => r.order_id))];
}

// Inside double quotes the characters PostgREST reserves in or() (, . : ( )) are plain text.
function quoteFilterValue(value) {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

async function needsActionFilter(now) {
  const staleBefore = new Date(now.getTime() - MANUAL_STALE_DAYS * 24 * 3600 * 1000).toISOString();
  const [jobOrderIds, returnOrderIds] = await Promise.all([failedJobOrderIds(), openReturnOrderIds()]);
  const orderIds = [...new Set([...jobOrderIds, ...returnOrderIds])];
  const clauses = [
    "status.eq.paid",
    "problem.not.is.null",
    "process_error.not.is.null",
    "status.eq.rto",
    `and(courier.in.(porter,self),status.in.(${MANUAL_OPEN_STATUSES.join(",")}),updated_at.lt.${quoteFilterValue(staleBefore)})`,
  ];
  if (orderIds.length) clauses.push(`id.in.(${orderIds.join(",")})`);
  return clauses.join(",");
}

// Returns a function rather than a query: a supabase query is thenable, so an async
// function returning one would run it.
async function queueFilter(queue, now) {
  if (!ORDER_QUEUES[queue]) throw new Error(`Unknown order queue: ${queue}`);
  const { statuses } = ORDER_QUEUES[queue];
  if (statuses) return (query) => query.in("status", statuses);
  const filter = await needsActionFilter(now);
  return (query) => query.or(filter);
}

async function fetchOrderRows(applyFilter) {
  const { data, error } = await applyFilter(supabase.from("orders").select(LIST_COLUMNS))
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) raise("Loading orders", error);
  return data || [];
}

export async function listOrders(queue = DEFAULT_QUEUE, now = new Date()) {
  return fetchOrderRows(await queueFilter(queue, now));
}

// LIKE gives \, % and _ a meaning; escape them. PostgREST turns every * into % even inside
// quotes, so a literal * cannot be sent: _ matches that one character and nothing wider.
function likeContains(term) {
  const literal = term.replace(/[\\%_]/g, "\\$&").replace(/\*/g, "_");
  return quoteFilterValue(`%${literal}%`);
}

// contact_phone is stored as +91XXXXXXXXXX (public._normalize_phone), so only the digits of a
// typed number can match. A term without digits skips the phone clause. Only a full 11-digit
// number loses its leading 0: stripping zeros from "WEB-000006" would match any phone with a 6.
export function orderSearchFilter(term) {
  const pattern = likeContains(term);
  const clauses = [`order_ref.ilike.${pattern}`, `contact_name.ilike.${pattern}`];
  const digits = term.replace(/\D/g, "").replace(/^0(\d{10})$/, "$1");
  if (digits) clauses.push(`contact_phone.ilike.${likeContains(digits)}`);
  return clauses.join(",");
}

// Every status, including unpaid and expired orders, which no queue shows.
export async function searchOrders(rawTerm) {
  const term = normalizeOrderSearch(rawTerm);
  if (!term) return [];
  const filter = orderSearchFilter(term);
  return fetchOrderRows((query) => query.or(filter));
}

// Embeds are aliased (items:, photos:), so they are ordered here instead of with referencedTable.
const byId = (a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0);
const byUploadedAt = (a, b) => Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at);
const sortReturns = (returns) =>
  returns.map((r) => ({
    ...r,
    items: [...(r.items || [])].sort(byId),
    photos: [...(r.photos || [])].sort(byUploadedAt),
  }));

export async function getOrder(id) {
  const [order, items, events, refunds, jobs, returns, packedPhotos] = await Promise.all([
    supabase.from("orders").select("*").eq("id", id).single(),
    supabase.from("order_items").select("*").eq("order_id", id).order("line_no"),
    supabase.from("order_events").select("*").eq("order_id", id).order("id"),
    supabase.from("order_refunds").select("*").eq("order_id", id).order("created_at"),
    supabase.from("order_jobs").select("*").eq("order_id", id).order("created_at"),
    // Photo storage paths are never selected: staff view a photo through return_photo_view.
    supabase
      .from("order_returns")
      .select("*, items:order_return_items(*), photos:order_return_photos(id, uploaded_at)")
      .eq("order_id", id)
      .order("opened_at"),
    supabase.from("order_packed_photos").select("id, uploaded_at").eq("order_id", id).order("uploaded_at"),
  ]);
  for (const [what, res] of [
    ["order", order],
    ["order items", items],
    ["order events", events],
    ["refunds", refunds],
    ["jobs", jobs],
    ["returns", returns],
    ["packed photos", packedPhotos],
  ]) {
    if (res.error) raise(`Loading ${what}`, res.error);
  }

  const refundIds = (refunds.data || []).map((r) => r.id);
  let legs = [];
  if (refundIds.length) {
    const res = await supabase
      .from("order_refund_legs")
      .select("*")
      .in("refund_id", refundIds)
      .order("created_at");
    if (res.error) raise("Loading refund legs", res.error);
    legs = res.data || [];
  }

  let bill = null;
  if (order.data.bill_id) {
    const res = await supabase
      .from("bills")
      .select("billid, bill_number, pdf_url, finalized, paymentstatus")
      .eq("billid", order.data.bill_id)
      .maybeSingle();
    if (res.error) raise("Loading bill", res.error);
    bill = res.data;
  }

  return {
    order: { ...order.data, returns: sortReturns(returns.data || []), packed_photos: packedPhotos.data || [] },
    bill,
    items: items.data || [],
    events: events.data || [],
    refunds: refunds.data || [],
    legs,
    jobs: jobs.data || [],
  };
}

export async function countQueue(queue, now = new Date()) {
  const applyFilter = await queueFilter(queue, now);
  const { count, error } = await applyFilter(
    supabase.from("orders").select("id", { count: "exact", head: true })
  );
  if (error) raise(`Counting ${ORDER_QUEUES[queue].label} orders`, error);
  return count ?? 0;
}

export async function countOrders(now = new Date()) {
  const [needs_action, in_progress] = await Promise.all([
    countQueue("needs_action", now),
    countQueue("in_progress", now),
  ]);
  return { needs_action, in_progress };
}

export async function getCheckoutLive() {
  const { data, error } = await supabase
    .from("storefront_settings")
    .select("checkout_live")
    .eq("id", 1)
    .single();
  if (error) raise("Loading checkout setting", error);
  return Boolean(data?.checkout_live);
}

export async function getMyRole() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error) raise("Loading role", error);
  return data?.role ?? null;
}

// Process/Cancel are retried by the server per op key: one key per staff click, reused
// when that same click is retried, so a retried request resumes instead of double-running.
export function newOpKey() {
  return window.crypto.randomUUID();
}

export async function action(payload) {
  const { data, error } = await supabase.functions.invoke("admin-order-action", {
    body: payload,
  });
  if (!error) return data;

  // FunctionsHttpError carries the Response; its body is { error, code }.
  const response = error.context;
  let body = null;
  if (response && typeof response.json === "function") {
    body = await response.json().catch(() => null);
  }
  throw new OrderActionError(body?.error || error.message, {
    status: response?.status ?? null,
    code: body?.code ?? null,
  });
}
