/**
 * Test doubles for the refund engine: an in-memory RefundDb that follows the
 * SQL functions' rules (online_refund_choose, _default_expired, _set_status,
 * _legs_due, _open_legs) and a fake Cashfree that keeps refunds by refund_id
 * the way the real gateway does. Used by *_test.ts only.
 */

import { type CashfreeClient, CashfreeError, type CfRefund, type CfRefundStatus } from "./cashfree.ts";
import type {
  ChooseResult,
  DueLeg,
  GatewayLeg,
  LegStatus,
  RefundChoice,
  RefundDb,
  RefundNotice,
  RefundPreview,
  RefundStatus,
  Voucher,
} from "./refunds.ts";
import { ChooseError } from "./refunds.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

export type FakeLeg = {
  id: string;
  source: "credit" | "gateway" | "shipping_credit" | "shipping_gateway";
  amount: number;
  status: "pending" | LegStatus;
  destination: "store_credit" | "voucher" | "original" | null;
  cfRefundId: string | null;
  voucher: Voucher | null;
  updatedAt: number;
};

export type FakeRefund = {
  id: string;
  orderRef: string;
  token: string | null;
  createdAt: number;
  expiresAt: number | null;
  status: RefundStatus;
  choice: RefundChoice | null;
  isGuest: boolean;
  reason: string;
  email: string | null;
  name: string;
  items: { name: string; size: string | null; color: string | null; units: number; categoryId: string | null }[];
  legs: FakeLeg[];
};

let seq = 0;
const uuid = () => crypto.randomUUID();

export class FakeClock {
  constructor(public t = Date.parse("2026-10-23T06:00:00Z")) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export class FakeRefundDb implements RefundDb {
  refunds: FakeRefund[] = [];
  problems: { orderRef: string; problem: string }[] = [];
  failures: (string | null)[] = [];
  statusWrites: { legId: string; status: LegStatus; cfRefundId: string | null }[] = [];
  constructor(readonly clock: FakeClock) {}

  /** A refund with a gateway leg (and optional credit leg) awaiting the shopper's choice. */
  add(opts: { gateway: number; credit?: number; shippingGateway?: number; isGuest?: boolean; email?: string | null; reason?: string } = {
    gateway: 1000,
  }): FakeRefund {
    const now = this.clock.now();
    const legs: FakeLeg[] = [];
    const leg = (source: FakeLeg["source"], amount: number): FakeLeg => ({
      id: uuid(),
      source,
      amount,
      status: "pending",
      destination: null,
      cfRefundId: null,
      voucher: null,
      updatedAt: now,
    });
    if (opts.credit) legs.push({ ...leg("credit", opts.credit), status: "completed", destination: "store_credit" });
    if (opts.gateway) legs.push(leg("gateway", opts.gateway));
    if (opts.shippingGateway) legs.push(leg("shipping_gateway", opts.shippingGateway));
    const hasGateway = legs.some((l) => l.status === "pending");
    const r: FakeRefund = {
      id: uuid(),
      orderRef: `WEB-${String(++seq).padStart(6, "0")}`,
      token: hasGateway ? "t".repeat(32) + uuid().replaceAll("-", "") : null,
      createdAt: now,
      expiresAt: hasGateway ? now + 48 * HOUR : null,
      status: "awaiting_choice",
      choice: null,
      isGuest: opts.isGuest ?? true,
      reason: opts.reason ?? "cancel",
      email: opts.email === undefined ? "shopper@example.com" : opts.email,
      name: "Test Shopper",
      items: [{ name: "Test Kurti", size: "M", color: "Red", units: 1, categoryId: "Kurti" }],
      legs,
    };
    this.recompute(r);
    this.refunds.push(r);
    return r;
  }

  leg(id: string): FakeLeg {
    const l = this.refunds.flatMap((r) => r.legs).find((x) => x.id === id);
    if (!l) throw new Error(`no leg ${id}`);
    return l;
  }

  private ownerOf(legId: string): FakeRefund {
    const r = this.refunds.find((x) => x.legs.some((l) => l.id === legId));
    if (!r) throw new Error(`no refund for leg ${legId}`);
    return r;
  }

  private recompute(r: FakeRefund) {
    const done = r.legs.every((l) => l.status === "completed");
    if (done) r.status = "completed";
    else if (r.legs.some((l) => l.status === "failed")) r.status = "failed";
    else if (r.choice === null && r.legs.some((l) => l.source.endsWith("gateway") && l.status === "pending")) {
      r.status = "awaiting_choice";
    } else r.status = "processing";
  }

  private completeCredit(r: FakeRefund, l: FakeLeg) {
    l.status = "completed";
    l.updatedAt = this.clock.now();
    if (r.isGuest) {
      l.destination = "voucher";
      l.voucher = { code: `VCODE${String(++seq).padStart(11, "0")}`, value: l.amount, expiry: "2027-10-23" };
    } else {
      l.destination = "store_credit";
    }
  }

  preview(token: string): Promise<RefundPreview | null> {
    const r = this.refunds.find((x) => x.token === token);
    if (!r) return Promise.resolve(null);
    const sum = (src: string[]) => r.legs.filter((l) => src.includes(l.source)).reduce((s, l) => s + l.amount, 0);
    return Promise.resolve({
      orderRef: r.orderRef,
      status: r.status,
      amount: sum(["credit", "gateway", "shipping_credit", "shipping_gateway"]),
      creditPart: sum(["credit", "shipping_credit"]),
      gatewayPart: sum(["gateway", "shipping_gateway"]),
      items: r.items.map(({ name, size, color, units }) => ({ name, size, color, units })),
      expiresAt: new Date(r.expiresAt!).toISOString(),
      isGuest: r.isGuest,
    });
  }

  choose(token: string, choice: RefundChoice): Promise<ChooseResult> {
    const r = this.refunds.find((x) => x.token === token);
    if (!r) return Promise.reject(new ChooseError("invalid_token", "refund link not valid"));
    if (r.choice !== null || r.status !== "awaiting_choice") {
      return Promise.reject(new ChooseError("already_chosen", "refund choice already made"));
    }
    if (r.expiresAt! < this.clock.now()) return Promise.reject(new ChooseError("expired", "refund link expired"));
    r.choice = choice;
    const gatewayLegs: GatewayLeg[] = [];
    for (const l of r.legs) {
      if (!l.source.endsWith("gateway") || l.status !== "pending") continue;
      if (choice === "store_credit") this.completeCredit(r, l);
      else {
        l.status = "processing";
        l.destination = "original";
        l.updatedAt = this.clock.now();
        gatewayLegs.push({ legId: l.id, orderRef: r.orderRef, amount: l.amount });
      }
    }
    this.recompute(r);
    return Promise.resolve({
      refundId: r.id,
      orderRef: r.orderRef,
      choice,
      status: r.status,
      vouchers: r.legs.flatMap((l) => (l.voucher ? [l.voucher] : [])),
      creditAdded: r.legs.filter((l) => l.destination === "store_credit" && l.status === "completed")
        .reduce((s, l) => s + l.amount, 0),
      gatewayLegs,
    });
  }

  defaultExpired(): Promise<string[]> {
    const out: string[] = [];
    for (const r of this.refunds) {
      if (r.status !== "awaiting_choice" || r.choice !== null || r.expiresAt === null) continue;
      if (r.expiresAt >= this.clock.now()) continue;
      r.choice = "original";
      for (const l of r.legs) {
        if (l.source.endsWith("gateway") && l.status === "pending") {
          l.status = "processing";
          l.destination = "original";
          l.updatedAt = this.clock.now();
        }
      }
      this.recompute(r);
      out.push(r.id);
    }
    return Promise.resolve(out);
  }

  private isOpen = (l: FakeLeg) =>
    l.source.endsWith("gateway") && l.status === "processing" && l.destination === "original";

  openLegs(refundId: string): Promise<GatewayLeg[]> {
    const r = this.refunds.find((x) => x.id === refundId);
    return Promise.resolve(
      (r?.legs ?? []).filter((l) => this.isOpen(l) && l.cfRefundId === null)
        .map((l) => ({ legId: l.id, orderRef: r!.orderRef, amount: l.amount })),
    );
  }

  legsDue(): Promise<DueLeg[]> {
    const now = this.clock.now();
    const out: DueLeg[] = [];
    for (const r of this.refunds) {
      for (const l of r.legs) {
        if (!this.isOpen(l)) continue;
        const age = now - l.updatedAt;
        if (l.cfRefundId === null ? age > 10 * MIN : age > HOUR) {
          out.push({
            legId: l.id,
            refundId: r.id,
            orderRef: r.orderRef,
            amount: l.amount,
            cfRefundId: l.cfRefundId,
            action: l.cfRefundId === null ? "submit" : "poll",
          });
        }
      }
    }
    return Promise.resolve(out);
  }

  setLegStatus(legId: string, status: LegStatus, cfRefundId: string | null, _note: string | null): Promise<void> {
    const l = this.leg(legId);
    if (l.destination !== "original") return Promise.reject(new Error(`leg ${legId} is not original`));
    this.statusWrites.push({ legId, status, cfRefundId });
    if (l.status === "completed") return Promise.resolve();
    l.status = status;
    l.cfRefundId = cfRefundId ?? l.cfRefundId;
    l.updatedAt = this.clock.now();
    this.recompute(this.ownerOf(legId));
    return Promise.resolve();
  }

  setProblem(orderRef: string, problem: string): Promise<void> {
    this.problems.push({ orderRef, problem });
    return Promise.resolve();
  }

  notice(refundId: string): Promise<RefundNotice | null> {
    const r = this.refunds.find((x) => x.id === refundId);
    if (!r) return Promise.resolve(null);
    const sum = (src: string[]) => r.legs.filter((l) => src.includes(l.source)).reduce((s, l) => s + l.amount, 0);
    return Promise.resolve({
      refundId: r.id,
      orderRef: r.orderRef,
      status: r.status,
      choice: r.choice,
      token: r.token,
      tokenExpiresAt: r.expiresAt === null ? null : new Date(r.expiresAt).toISOString(),
      amount: sum(["credit", "gateway", "shipping_credit", "shipping_gateway"]),
      creditPart: sum(["credit", "shipping_credit"]),
      gatewayPart: sum(["gateway", "shipping_gateway"]),
      email: r.email,
      name: r.name,
      isGuest: r.isGuest,
      reason: r.reason,
      items: r.items,
      legs: r.legs.map((l) => ({
        source: l.source,
        amount: l.amount,
        status: l.status,
        destination: l.destination,
        voucher: l.voucher,
      })),
    });
  }

  rateLimited(ipHash: string | null): Promise<boolean> {
    return Promise.resolve(ipHash !== null && this.failures.filter((f) => f === ipHash).length >= 10);
  }

  recordFailure(ipHash: string | null): Promise<void> {
    if (ipHash !== null) this.failures.push(ipHash);
    return Promise.resolve();
  }
}

/** Cashfree that keeps refunds by refund_id; a repeated refund_id is refused (409). */
export class FakeCashfree {
  refunds = new Map<string, CfRefund & { orderRef: string }>();
  createCalls: { orderRef: string; refundId: string; amount: number }[] = [];
  getCalls: string[] = [];
  /** Status a new refund gets. */
  nextStatus: CfRefundStatus = "PENDING";
  /** Errors thrown by the next createRefund calls (consumed in order). */
  createErrors: CashfreeError[] = [];
  /** When true, a failing create still records the refund (ambiguous timeout that took effect). */
  errorTookEffect = false;

  /** Amount Cashfree has accepted for a refund id (one refund per id). */
  accepted(refundId: string): number {
    return this.refunds.get(refundId)?.amount ?? 0;
  }

  client(): CashfreeClient {
    const notUsed = () => Promise.reject(new Error("not used in refund tests"));
    return {
      createOrder: notUsed,
      getOrder: notUsed,
      getPayments: notUsed,
      verifyWebhook: notUsed,
      createRefund: (orderRef, { refundId, amount }) => {
        this.createCalls.push({ orderRef, refundId, amount });
        const err = this.createErrors.shift();
        if (this.refunds.has(refundId)) {
          return Promise.reject(new CashfreeError(409, "refund_already_exists", "refund_id already exists"));
        }
        if (err && !this.errorTookEffect) return Promise.reject(err);
        const r = { cfRefundId: `cf_${refundId.slice(0, 8)}`, refundId, status: this.nextStatus, amount, orderRef };
        this.refunds.set(refundId, r);
        if (err) return Promise.reject(err);
        const { orderRef: _o, ...out } = r;
        return Promise.resolve(out);
      },
      getRefund: (_orderRef, refundId) => {
        this.getCalls.push(refundId);
        const r = this.refunds.get(refundId);
        if (!r) return Promise.resolve(null);
        const { orderRef: _o, ...out } = r;
        return Promise.resolve(out);
      },
    };
  }
}

export const silentLog = () => {};
export { HOUR, MIN };
