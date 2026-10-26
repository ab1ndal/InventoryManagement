// Data access for the admin Online Orders screen.
// Reads: direct selects under the admin RLS policies (schema/migration_online_orders.sql).
// Writes: only through the `admin-order-action` Edge Function
// (docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md).
import { supabase } from "../../../lib/supabaseClient";

export const LIST_LIMIT = 200;

// Tab key → which orders it shows. "problems" is handled separately (needs failed jobs).
export const ORDER_FILTERS = {
  to_check: { label: "To check", statuses: ["paid"] },
  processing: { label: "Processing", statuses: ["processing", "cancelling"] },
  packed: { label: "Packed", statuses: ["packed"] },
  shipped: { label: "Shipped", statuses: ["shipped", "out_for_delivery"] },
  delivered: { label: "Delivered", statuses: ["delivered"] },
  problems: { label: "Problems" },
  all: { label: "All" },
};

const LIST_COLUMNS =
  "id, order_ref, created_at, status, contact_name, contact_phone, subtotal, promo_discount, " +
  "shipping, voucher_applied, credit_applied, gateway_amount, problem, process_error, " +
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

export async function listOrders(filter = "all") {
  if (!ORDER_FILTERS[filter]) throw new Error(`Unknown order filter: ${filter}`);
  let query = supabase.from("orders").select(LIST_COLUMNS);

  if (filter === "problems") {
    const jobOrderIds = await failedJobOrderIds();
    const clauses = ["problem.not.is.null", "process_error.not.is.null", "status.eq.rto"];
    if (jobOrderIds.length) clauses.push(`id.in.(${jobOrderIds.join(",")})`);
    query = query.or(clauses.join(","));
  } else if (ORDER_FILTERS[filter].statuses) {
    query = query.in("status", ORDER_FILTERS[filter].statuses);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) raise("Loading orders", error);
  return data || [];
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
  const [order, items, events, refunds, jobs, returns] = await Promise.all([
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
  ]);
  for (const [what, res] of [
    ["order", order],
    ["order items", items],
    ["order events", events],
    ["refunds", refunds],
    ["jobs", jobs],
    ["returns", returns],
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

  return {
    order: { ...order.data, returns: sortReturns(returns.data || []) },
    items: items.data || [],
    events: events.data || [],
    refunds: refunds.data || [],
    legs,
    jobs: jobs.data || [],
  };
}

export async function countOrdersToCheck() {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "paid");
  if (error) raise("Counting orders to check", error);
  return count ?? 0;
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
