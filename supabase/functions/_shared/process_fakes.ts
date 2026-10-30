/**
 * Test doubles for process.ts callers: an in-memory OrdersDb that mimics the
 * online_order_* state rules the edge code relies on (claim lease, op-key fence on
 * Process checkpoints and mark_packed, checkpoint skips, status guards, send back / rebook claims,
 * sr_cancelled, manual cancel confirmation and the two finalize functions), and a recording
 * Shiprocket client with failure injection.
 * The real SQL behaviour is covered by schema/test_online_orders*.sql.
 */

import { DbError, type OrderItemRow, type OrderRow, type OrdersDb, type ProcessPlan } from "./process.ts";
import {
  type AwbResult,
  type PickupResult,
  type ShiprocketClient,
  ShiprocketError,
  type SrOrderIds,
  type SrOrderInput,
  type TrackResult,
} from "./shiprocket.ts";

export const ORDER_ID = "00000000-0000-4000-8000-000000000001";
export const ITEM_A = "00000000-0000-4000-8000-0000000000a1";
export const ITEM_B = "00000000-0000-4000-8000-0000000000b1";

export function fakeOrder(over: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID,
    order_ref: "WEB-000123",
    status: "paid",
    fulfilment: "ship",
    contact_name: "Asha Verma",
    contact_phone: "+919876543210",
    contact_email: "asha@example.com",
    address: {
      line1: "12 MG Road",
      line2: "Near Clock Tower",
      city: "Ghaziabad",
      state: "Uttar Pradesh",
      pincode: "201001",
    },
    created_at: "2026-10-23T05:00:00Z",
    paid_at: "2026-10-23T05:01:00Z",
    quoted_courier_id: 10,
    sr_order_id: "111",
    sr_shipment_id: "222",
    sr_updated_at: null,
    awb: null,
    courier_id: null,
    courier_name: null,
    pickup_requested_at: null,
    manifest_url: null,
    label_url: null,
    bill_id: null,
    op_key: null,
    op_action: null,
    op_lease_until: null,
    process_error: null,
    process_plan: null,
    problem: null,
    sr_sync_status: null,
    sr_last_error: null,
    sr_attempt: 1,
    sr_cancelled_op_key: null,
    manual_cancel_confirmed_by: null,
    ...over,
  };
}

/** A: Lehenga ×1 (₹3,000 paid); B: Kurti ×2 (₹1,000 paid). */
export function fakeItems(): OrderItemRow[] {
  return [
    {
      id: ITEM_A,
      line_no: 1,
      productid: "BC25001",
      product_name: "Lehenga",
      size: "M",
      color: "Red",
      category_id: "LE",
      category_name: "Lehenga",
      qty: 1,
      paid_value: 3000,
      stock_taken: 1,
      refunded_qty: 0,
    },
    {
      id: ITEM_B,
      line_no: 2,
      productid: "BC25002",
      product_name: "Kurti",
      size: "L",
      color: "Blue",
      category_id: "KUR",
      category_name: "Kurti",
      qty: 2,
      paid_value: 1000,
      stock_taken: 2,
      refunded_qty: 0,
    },
  ];
}

export const FULL_PLAN: ProcessPlan = {
  shippable_items: [
    { item_id: ITEM_A, units: 1, paid_value: 3000 },
    { item_id: ITEM_B, units: 2, paid_value: 1000 },
  ],
  all_unavailable: false,
  refund_id: null,
};

const raised = (fn: string, msg: string) => new DbError(fn, "P0001", msg);

export class FakeDb implements OrdersDb {
  order: OrderRow;
  items: OrderItemRow[];
  plan: ProcessPlan;
  calls: { fn: string; args: Record<string, unknown> }[] = [];
  jobsReset = 0;
  billId = 9001;
  /** Finalize events (sent_back / rebooked) with the op key and result, for idempotent repeats. */
  events: { kind: string; opKey: string; result: Record<string, unknown> }[] = [];
  /** Returns shown on the order; photo paths by photo id. */
  returns: Record<string, unknown>[] = [];
  /** Which order reader was used, in order. */
  orderReads: string[] = [];
  photoPaths = new Map<string, string>();
  returnOrders = new Map<string, string>();
  /** rpc name → message: the next call to it raises (a business-rule refusal). */
  rpcRaises = new Map<string, string>();
  /** rpc name → Postgres SQLSTATE: the next call to it fails with that code. */
  rpcErrorCodes = new Map<string, string>();

  constructor(order: Partial<OrderRow> = {}, plan: ProcessPlan = FULL_PLAN, items = fakeItems()) {
    this.order = fakeOrder(order);
    this.plan = plan;
    this.items = items;
  }

  fns(): string[] {
    return this.calls.map((c) => c.fn === "online_order_checkpoint" ? `checkpoint:${c.args.p_step}` : c.fn);
  }

  getOrder(id: string): Promise<OrderRow | null> {
    this.orderReads.push("getOrder");
    return Promise.resolve(id === this.order.id ? structuredClone(this.order) : null);
  }

  getOrderWithReturns(id: string): Promise<OrderRow | null> {
    this.orderReads.push("getOrderWithReturns");
    return Promise.resolve(id === this.order.id ? structuredClone({ ...this.order, returns: this.returns }) : null);
  }

  getReturnPhotoPath(photoId: string): Promise<string | null> {
    return Promise.resolve(this.photoPaths.get(photoId) ?? null);
  }

  getReturnOrderId(returnId: string): Promise<string | null> {
    return Promise.resolve(this.returnOrders.get(returnId) ?? null);
  }

  getItems(orderId: string): Promise<OrderItemRow[]> {
    return Promise.resolve(orderId === this.order.id ? structuredClone(this.items) : []);
  }

  private leaseLive(): boolean {
    return !!this.order.op_lease_until && Date.parse(this.order.op_lease_until) > Date.now();
  }

  private clearOp() {
    Object.assign(this.order, { op_key: null, op_action: null, op_lease_until: null });
  }

  // deno-lint-ignore require-await
  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    this.calls.push({ fn, args });
    const o = this.order;
    const raiseMsg = this.rpcRaises.get(fn);
    if (raiseMsg) throw raised(fn, raiseMsg);
    const errCode = this.rpcErrorCodes.get(fn);
    if (errCode) throw new DbError(fn, errCode, "simulated database error");
    const lease = () => new Date(Date.now() + 5 * 60_000).toISOString();
    switch (fn) {
      case "online_order_claim": {
        const action = args.p_action as string;
        const key = args.p_op_key as string;
        const target = action === "process" ? "processing" : "cancelling";
        const res = (claimed: boolean, resumed: boolean, reason?: string) =>
          ({ claimed, resumed, ...(reason ? { reason } : {}), status: o.status, order: structuredClone(o) }) as T;
        if (o.fulfilment === "pickup" && action !== "cancel") return res(false, false, "status");
        if ((action === "send_back" || action === "rebook") && o.op_action === action) {
          if (o.op_key === key) {
            o.op_lease_until = lease();
            return res(true, true);
          }
          if (this.leaseLive()) return res(false, false, "busy");
          Object.assign(o, { op_key: key, op_lease_until: lease() });
          return res(true, true);
        }
        if (action === "send_back") {
          if (o.status !== "processing") return res(false, false, "status");
          if (o.op_action !== "process" || this.leaseLive()) {
            return res(false, false, o.op_action !== "process" ? "other_action" : "busy");
          }
          if (o.op_key === key) throw raised(fn, "online_order_claim: send_back needs a new op key");
          Object.assign(o, { op_key: key, op_action: action, op_lease_until: lease() });
          return res(true, false);
        }
        if (action === "rebook") {
          if (!["packed", "shipped", "out_for_delivery"].includes(o.status)) return res(false, false, "status");
          if (o.op_action !== null) return res(false, false, "other_action");
          Object.assign(o, { op_key: key, op_action: action, op_lease_until: lease() });
          return res(true, false);
        }
        if (o.status === "processing" || o.status === "cancelling") {
          if (o.op_key === key && o.op_action === action) {
            o.op_lease_until = lease();
            return { claimed: true, resumed: true, status: o.status } as T;
          }
          if (this.leaseLive() || o.op_action !== action) {
            return {
              claimed: false,
              resumed: false,
              reason: o.op_action !== action ? "other_action" : "busy",
              status: o.status,
            } as T;
          }
          Object.assign(o, { op_key: key, op_lease_until: lease() });
          return { claimed: true, resumed: true, status: o.status } as T;
        }
        if (!(o.status === "paid" || (action === "cancel" && o.status === "ready_for_pickup"))) {
          return { claimed: false, resumed: false, reason: "status", status: o.status } as T;
        }
        Object.assign(o, {
          status: target,
          op_key: key,
          op_action: action,
          op_lease_until: lease(),
          process_error: null,
        });
        return { claimed: true, resumed: false, status: o.status } as T;
      }
      case "online_order_prepare_process": {
        if (o.process_plan) return structuredClone(o.process_plan) as T;
        if (o.status !== "processing" || o.op_action !== "process") throw raised(fn, `order is ${o.status}`);
        o.process_plan = structuredClone(this.plan);
        if (this.plan.all_unavailable) {
          o.status = "cancelled";
          this.clearOp();
        }
        return structuredClone(this.plan) as T;
      }
      case "online_order_checkpoint": {
        const step = args.p_step as string;
        const d = (args.p_data ?? {}) as Record<string, unknown>;
        let skipped = false;
        const key = (args.p_op_key ?? null) as string | null;
        const shared = step === "sr_create" || step === "sr_create_failed" || step === "error";
        if (shared ? key !== null && key !== o.op_key : key === null || key !== o.op_key) {
          throw raised(fn, `checkpoint ${step}: stale operation`);
        }
        if (step === "sr_cancelled") {
          if (o.op_action !== "send_back" && o.op_action !== "rebook") {
            throw raised(fn, `checkpoint sr_cancelled: no send back / rebook in progress (op ${o.op_action})`);
          }
          skipped = o.sr_cancelled_op_key === key;
          o.sr_cancelled_op_key = key;
        } else if (step === "sr_create" || step === "sr_create_failed") {
          if (!["paid", "processing", "cancelling"].includes(o.status)) throw raised(fn, `order is ${o.status}`);
          skipped = o.sr_order_id !== null || o.op_action === "send_back" || o.op_action === "rebook";
          if (!skipped && step === "sr_create") {
            Object.assign(o, { sr_order_id: d.sr_order_id, sr_shipment_id: d.sr_shipment_id, sr_sync_status: "ok" });
          } else if (!skipped) {
            Object.assign(o, { sr_sync_status: "failed", sr_last_error: d.error });
          }
        } else if (step === "error") {
          if (!["paid", "processing", "cancelling"].includes(o.status)) throw raised(fn, `order is ${o.status}`);
          Object.assign(o, { process_error: d.error, op_lease_until: new Date().toISOString() });
        } else {
          if (o.status !== "processing") throw raised(fn, `checkpoint ${step}: order is ${o.status}`);
          const col = {
            sr_update: "sr_updated_at",
            awb: "awb",
            pickup: "pickup_requested_at",
            manifest: "manifest_url",
            label: "label_url",
          }[step];
          if (!col) throw raised(fn, `unknown step ${step}`);
          skipped = o[col] !== null;
          if (!skipped) {
            if (step === "awb") {
              Object.assign(o, { awb: d.awb, courier_id: d.courier_id, courier_name: d.courier_name });
            } else if (step === "manifest") o.manifest_url = d.manifest_url as string;
            else if (step === "label") o.label_url = d.label_url as string;
            else o[col] = new Date().toISOString();
          }
        }
        return { step, skipped } as T;
      }
      case "online_order_mark_packed": {
        if (!args.p_op_key || args.p_op_key !== o.op_key) throw raised(fn, "mark_packed: stale operation");
        if (o.status !== "processing" || o.op_action !== "process") throw raised(fn, `order is ${o.status}`);
        if (!o.awb || !o.label_url) throw raised(fn, "awb and label_url are required");
        Object.assign(o, { status: "packed", bill_id: this.billId, process_error: null });
        this.clearOp();
        return this.billId as T;
      }
      case "online_order_confirm_manual_cancel": {
        if (!args.p_op_key || args.p_op_key !== o.op_key) throw raised(fn, "confirm_manual_cancel: stale operation");
        if (o.op_action !== "send_back" && o.op_action !== "rebook") {
          throw raised(fn, `confirm_manual_cancel: no send_back / rebook in progress (op ${o.op_action})`);
        }
        o.manual_cancel_confirmed_by = args.p_actor as string;
        return null as T;
      }
      case "online_order_send_back":
      case "online_order_rebook": {
        const action = fn === "online_order_send_back" ? "send_back" : "rebook";
        const kind = action === "send_back" ? "sent_back" : "rebooked";
        const key = args.p_op_key as string;
        const done = this.events.find((e) => e.kind === kind && e.opKey === key);
        if (done && o.op_action === null) return structuredClone(done.result) as T;
        if (!key || key !== o.op_key) throw raised(fn, `${action}: stale operation`);
        const from = action === "send_back" ? ["processing"] : ["packed", "shipped", "out_for_delivery"];
        if (!from.includes(o.status) || o.op_action !== action) {
          throw raised(fn, `${action}: order has no ${action} in progress (status ${o.status}, op ${o.op_action})`);
        }
        if (action === "rebook" && !String(args.p_note ?? "").trim()) throw raised(fn, "rebook: note required");
        if (
          !((o.sr_order_id === null && o.awb === null) || o.sr_cancelled_op_key === key ||
            o.manual_cancel_confirmed_by !== null)
        ) throw raised(fn, `${action}: courier booking not cancelled yet`);
        // Fake rule: a lost parcel with nothing left on the shelf cancels and refunds.
        const lostAll = action === "rebook" && args.p_parcel_lost === true;
        const status = lostAll ? "cancelled" : "paid";
        const result: Record<string, unknown> = {
          status,
          old_sr_order_id: o.sr_order_id,
          old_awb: o.awb,
          ...(action === "rebook" ? { refund_id: lostAll ? "refund-rebook" : null } : {}),
        };
        Object.assign(o, {
          sr_order_id: null,
          sr_shipment_id: null,
          sr_updated_at: null,
          awb: null,
          courier_id: null,
          courier_name: null,
          pickup_requested_at: null,
          manifest_url: null,
          label_url: null,
          process_plan: null,
          process_error: null,
          problem: null,
          sr_attempt: o.sr_attempt + 1,
          sr_cancelled_op_key: null,
          manual_cancel_confirmed_by: null,
          status,
        });
        this.clearOp();
        this.events.push({ kind, opKey: key, result });
        return structuredClone(result) as T;
      }
      case "online_order_release_op": {
        if (o.op_action !== "send_back" && o.op_action !== "rebook") {
          throw raised(fn, `release: no send back / rebook in progress (status ${o.status}, op ${o.op_action})`);
        }
        if (!args.p_op_key || (args.p_op_key !== o.op_key && this.leaseLive())) {
          throw raised(fn, "release: stale operation");
        }
        if (o.sr_cancelled_op_key !== null || o.manual_cancel_confirmed_by !== null) {
          throw raised(fn, "release: courier booking already cancelled — finish the action");
        }
        if (o.op_action === "send_back") {
          Object.assign(o, { op_action: "process", op_lease_until: new Date(Date.now() - 1000).toISOString() });
        } else this.clearOp();
        return structuredClone(o) as T;
      }
      case "online_order_cancel": {
        if (!(o.status === "paid" || (o.status === "cancelling" && o.op_action === "cancel"))) {
          throw raised(fn, `cancel is only allowed for paid orders (now ${o.status})`);
        }
        o.status = "cancelled";
        this.clearOp();
        return "refund-cancel" as T;
      }
      case "online_order_set_problem":
        o.problem = args.p_problem as string;
        return null as T;
      case "online_order_set_availability":
        if (o.status !== "paid") throw raised(fn, `order is ${o.status}`);
        return null as T;
      case "online_order_rto_received":
        if (o.status !== "rto") throw raised(fn, `order is ${o.status}`);
        o.status = "rto_received";
        return "refund-rto" as T;
      case "online_job_retry":
        return this.jobsReset as T;
      case "online_set_checkout_live":
        return { checkout_live: args.p_live, changed: true } as T;
      case "online_order_mark_delivered":
        return { delivered: true } as T;
      case "online_order_mark_ready":
        if (o.fulfilment !== "pickup") throw raised(fn, `mark_ready: order ${o.order_ref} is not a store pickup`);
        if (o.status !== "paid") throw raised(fn, `mark_ready: order must be paid (status ${o.status})`);
        Object.assign(o, { status: "ready_for_pickup", bill_id: 77 });
        return { status: o.status, bill_id: 77, refund_id: null, all_unavailable: false } as T;
      case "online_order_mark_collected":
        if (o.status !== "ready_for_pickup") throw raised(fn, `mark_collected: order must be ready for pickup`);
        Object.assign(o, { status: "delivered", delivered_at: "2026-10-30T10:00:00Z" });
        return { status: o.status, delivered_at: o.delivered_at } as T;
      case "online_return_open":
        return "dddddddd-dddd-4ddd-8ddd-dddddddddddd" as T;
      case "online_return_cancel":
        return null as T;
      case "online_return_preview":
        return { credit_part: 100, gateway_part: 400, shipping: 0, total: 500 } as T;
      case "online_return_receive":
        return { status: "refunded", refund_id: "refund-return", refund: { total: 500 } } as T;
      case "online_return_photo_path":
        return `${o.id}/${args.p_return_id}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.${args.p_ext}` as T;
      case "online_return_add_photo":
        return "ffffffff-ffff-4fff-8fff-ffffffffffff" as T;
      case "online_order_apply_tracking":
        return { matched: true, changed: true, status: args.p_status } as T;
      default:
        throw new Error(`FakeDb: unexpected rpc ${fn}`);
    }
  }
}

type Method = keyof ShiprocketClient;

export class FakeShiprocket implements ShiprocketClient {
  calls: { method: Method; args: unknown[] }[] = [];
  /** Methods that fail on their next call only. */
  failOnce = new Set<Method>();
  /** HTTP status of an injected failure (200 = Shiprocket answered and refused). */
  failStatus = 200;
  /** Methods that wait on this promise before answering. */
  gates = new Map<Method, Promise<void>>();
  trackResult: TrackResult = {
    hasData: true,
    shipmentStatusId: 7,
    currentStatus: "DELIVERED",
    trackUrl: "https://shiprocket.co/tracking/AWB1",
    etd: null,
  };

  count(method: Method): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  methods(): Method[] {
    return this.calls.map((c) => c.method);
  }

  private async hit(method: Method, args: unknown[]): Promise<void> {
    this.calls.push({ method, args });
    const gate = this.gates.get(method);
    if (gate) await gate;
    if (this.failOnce.delete(method)) throw new ShiprocketError(this.failStatus, `${method}: injected failure`);
  }

  async token() {
    await this.hit("token", []);
    return "t";
  }
  async postcodeState(pincode: string) {
    await this.hit("postcodeState", [pincode]);
    return "Uttar Pradesh";
  }
  async rate(input: { deliveryPincode: string; weightKg: number; declaredValue: number }) {
    await this.hit("rate", [input]);
    return null;
  }
  async createOrder(input: SrOrderInput, fallbackEmail: string): Promise<SrOrderIds> {
    await this.hit("createOrder", [input, fallbackEmail]);
    return { srOrderId: 111, shipmentId: 222 };
  }
  async updateOrder(input: SrOrderInput, fallbackEmail: string): Promise<SrOrderIds> {
    await this.hit("updateOrder", [input, fallbackEmail]);
    return { srOrderId: 111, shipmentId: 222 };
  }
  async assignAwb(shipmentId: number, courierId?: number): Promise<AwbResult> {
    await this.hit("assignAwb", [shipmentId, courierId]);
    return { awb: "AWB1", courierId: 10, courierName: "Delhivery" };
  }
  async pickup(shipmentId: number): Promise<PickupResult> {
    await this.hit("pickup", [shipmentId]);
    return { scheduledDate: "2026-10-24", tokenNumber: "PK1" };
  }
  async manifest(shipmentId: number, srOrderId: number): Promise<string> {
    await this.hit("manifest", [shipmentId, srOrderId]);
    return "https://example.test/manifest.pdf";
  }
  async label(shipmentId: number): Promise<string> {
    await this.hit("label", [shipmentId]);
    return "https://example.test/label.pdf";
  }
  async cancel(srOrderIds: number[]): Promise<void> {
    await this.hit("cancel", [srOrderIds]);
  }
  async cancelAwbs(awbs: string[]): Promise<void> {
    await this.hit("cancelAwbs", [awbs]);
  }
  async track(awb: string): Promise<TrackResult> {
    await this.hit("track", [awb]);
    return structuredClone(this.trackResult);
  }
}
