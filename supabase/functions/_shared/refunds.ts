/**
 * Refund engine, Edge side (plan Task 10, R13). The database owns every refund
 * state change (schema/migration_online_orders.sql, *_refunds.sql); this module
 * only moves gateway legs through Cashfree and reports back.
 *
 * Idempotency: each gateway leg is one Cashfree refund whose refund_id (and
 * x-idempotency-key) is the leg id, so a retried or concurrent submission can
 * never pay out twice. The amount sent is exactly the leg amount the DB gave.
 * A leg counts as submitted once cf_refund_id is stored.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { type CashfreeClient, type CashfreeEnv, CashfreeError, type CfRefund, createCashfree } from "./cashfree.ts";

export type RefundStatus = "awaiting_choice" | "processing" | "completed" | "failed";
export type RefundChoice = "store_credit" | "original";
export type LegStatus = "processing" | "completed" | "failed";

/** Contract shape of `refund-choice` preview (online_refund_preview). */
export type RefundPreview = {
  orderRef: string;
  status: RefundStatus;
  amount: number;
  creditPart: number;
  gatewayPart: number;
  items: { name: string; size: string | null; color: string | null; units: number }[];
  expiresAt: string;
  isGuest: boolean;
};

export type Voucher = { code: string; value: number; expiry: string };

export type ChooseResult = {
  refundId: string;
  orderRef: string;
  choice: RefundChoice;
  status: RefundStatus;
  vouchers: Voucher[];
  creditAdded: number;
  gatewayLegs: GatewayLeg[];
};

/** A gateway leg to send to Cashfree. */
export type GatewayLeg = { legId: string; orderRef: string; amount: number };
export type DueLeg = GatewayLeg & { refundId: string; cfRefundId: string | null; action: "submit" | "poll" };

/** online_refund_notice: everything the refund emails need. */
export type RefundNotice = {
  refundId: string;
  orderRef: string;
  status: RefundStatus;
  choice: RefundChoice | null;
  token: string | null;
  tokenExpiresAt: string | null;
  amount: number;
  creditPart: number;
  gatewayPart: number;
  email: string | null;
  name: string;
  isGuest: boolean;
  /** order_refunds.reason: 'cancel' | 'rto' | 'return' | ... */
  reason: string;
  items: { name: string; size: string | null; color: string | null; units: number; categoryId: string | null }[];
  legs: {
    source: "credit" | "gateway" | "shipping_credit" | "shipping_gateway";
    amount: number;
    status: "pending" | LegStatus;
    destination: "store_credit" | "voucher" | "original" | null;
    voucher: Voucher | null;
  }[];
};

export type ChooseErrorCode = "invalid_token" | "already_chosen" | "expired" | "bad_choice";
export class ChooseError extends Error {
  constructor(readonly code: ChooseErrorCode, message: string) {
    super(message);
    this.name = "ChooseError";
  }
}

/** Data port for refunds: one method per DB function. */
export type RefundDb = {
  preview(token: string): Promise<RefundPreview | null>;
  /** Throws ChooseError for the refusals online_refund_choose raises. */
  choose(token: string, choice: RefundChoice): Promise<ChooseResult>;
  defaultExpired(): Promise<string[]>;
  openLegs(refundId: string): Promise<GatewayLeg[]>;
  legsDue(): Promise<DueLeg[]>;
  setLegStatus(legId: string, status: LegStatus, cfRefundId: string | null, note: string | null): Promise<void>;
  setProblem(orderRef: string, problem: string): Promise<void>;
  notice(refundId: string): Promise<RefundNotice | null>;
  rateLimited(ipHash: string | null): Promise<boolean>;
  recordFailure(ipHash: string | null): Promise<void>;
};

export type Log = (event: string, data: Record<string, unknown>) => void;
export const jsonLog: Log = (event, data) => console.log(JSON.stringify({ event, ...data }));

export type RefundCtx = { db: RefundDb; cashfree: CashfreeClient; log: Log };

export type LegOutcome = {
  legId: string;
  /** "pending": not sent or not confirmed yet (ambiguous error); the sweeper retries. */
  result: LegStatus | "pending";
  error?: string;
};

const FAILED_STATUSES = new Set(["CANCELLED", "REJECTED"]);

function legStatusOf(r: CfRefund): LegStatus {
  if (r.status === "SUCCESS") return "completed";
  if (FAILED_STATUSES.has(r.status)) return "failed";
  return "processing";
}

/** Writes Cashfree's view of a leg to the DB; a failed leg also flags the order. */
async function applyRefund(ctx: RefundCtx, leg: GatewayLeg, r: CfRefund): Promise<LegStatus> {
  const status = legStatusOf(r);
  const note = status === "processing" ? null : r.status;
  await ctx.db.setLegStatus(leg.legId, status, r.cfRefundId || null, note);
  if (status === "failed") {
    await ctx.db.setProblem(
      leg.orderRef,
      `Refund of ₹${leg.amount} (leg ${leg.legId}) ${r.status} by Cashfree: refund it manually`,
    );
  }
  ctx.log("refund_leg_status", { legId: leg.legId, orderRef: leg.orderRef, cashfree: r.status, status });
  return status;
}

/**
 * Sends each leg to Cashfree once (refund_id = leg id) and records the result.
 * Never throws for one leg's failure; returns an outcome per leg.
 */
export async function submitGatewayLegs(ctx: RefundCtx, legs: GatewayLeg[]): Promise<LegOutcome[]> {
  const out: LegOutcome[] = [];
  const seen = new Set<string>();
  for (const leg of legs) {
    if (seen.has(leg.legId)) continue;
    seen.add(leg.legId);
    out.push(await submitOne(ctx, leg));
  }
  return out;
}

async function submitOne(ctx: RefundCtx, leg: GatewayLeg): Promise<LegOutcome> {
  if (!Number.isFinite(leg.amount) || leg.amount <= 0) {
    const error = `leg amount must be positive, got ${leg.amount}`;
    ctx.log("refund_leg_invalid", { legId: leg.legId, orderRef: leg.orderRef, error });
    return { legId: leg.legId, result: "pending", error };
  }
  try {
    let refund: CfRefund;
    try {
      refund = await ctx.cashfree.createRefund(leg.orderRef, {
        refundId: leg.legId,
        amount: leg.amount,
        note: `Refund for ${leg.orderRef}`,
      });
    } catch (err) {
      if (!(err instanceof CashfreeError) || err.ambiguous) throw err;
      // Definite 4xx. A repeat of an accepted refund_id is refused too, so look
      // it up before treating the leg as failed.
      const existing = await ctx.cashfree.getRefund(leg.orderRef, leg.legId);
      if (!existing) {
        await ctx.db.setLegStatus(leg.legId, "failed", null, `${err.code}: ${err.message}`.slice(0, 500));
        await ctx.db.setProblem(
          leg.orderRef,
          `Refund of ₹${leg.amount} (leg ${leg.legId}) refused by Cashfree (${err.code}): refund it manually`,
        );
        ctx.log("refund_leg_refused", { legId: leg.legId, orderRef: leg.orderRef, code: err.code });
        return { legId: leg.legId, result: "failed", error: err.code };
      }
      refund = existing;
    }
    return { legId: leg.legId, result: await applyRefund(ctx, leg, refund) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.log("refund_leg_submit_error", { legId: leg.legId, orderRef: leg.orderRef, error });
    return { legId: leg.legId, result: "pending", error };
  }
}

/** Re-reads submitted legs from Cashfree; only changes are written. */
export async function pollGatewayLegs(ctx: RefundCtx, legs: GatewayLeg[]): Promise<LegOutcome[]> {
  const out: LegOutcome[] = [];
  for (const leg of legs) {
    try {
      const refund = await ctx.cashfree.getRefund(leg.orderRef, leg.legId);
      if (!refund) {
        // We stored a cf_refund_id, so Cashfree accepted it once: needs a human.
        await ctx.db.setProblem(leg.orderRef, `Refund leg ${leg.legId} not found at Cashfree: check the dashboard`);
        ctx.log("refund_leg_missing", { legId: leg.legId, orderRef: leg.orderRef });
        out.push({ legId: leg.legId, result: "pending", error: "not_found" });
        continue;
      }
      const status = legStatusOf(refund);
      if (status === "processing") {
        out.push({ legId: leg.legId, result: "processing" });
        continue;
      }
      out.push({ legId: leg.legId, result: await applyRefund(ctx, leg, refund) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ctx.log("refund_leg_poll_error", { legId: leg.legId, orderRef: leg.orderRef, error });
      out.push({ legId: leg.legId, result: "pending", error });
    }
  }
  return out;
}

/** Cashfree client from function secrets; null when the credentials are not set. */
export function cashfreeFromEnv(
  get: (k: string) => string | undefined = (k) => Deno.env.get(k),
): CashfreeClient | null {
  const clientId = get("CASHFREE_CLIENT_ID")?.trim() ?? "";
  const clientSecret = get("CASHFREE_CLIENT_SECRET")?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  // createCashfree rejects anything but sandbox|production, so a missing env fails loudly.
  return createCashfree({ clientId, clientSecret, env: (get("CASHFREE_ENV")?.trim() ?? "") as CashfreeEnv, fetch });
}

// ---------- Supabase adapter ----------

const CHOOSE_ERRORS: Record<string, ChooseErrorCode> = {
  "refund link not valid": "invalid_token",
  "refund choice already made": "already_chosen",
  "refund link expired": "expired",
  "bad choice": "bad_choice",
};

async function rpc<T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

const num = (v: unknown): number => Number(v);

export function supabaseRefundDb(client: SupabaseClient): RefundDb {
  return {
    async preview(token) {
      return await rpc<RefundPreview | null>(client, "online_refund_preview", { p_token: token });
    },
    async choose(token, choice) {
      const { data, error } = await client.rpc("online_refund_choose", { p_token: token, p_choice: choice });
      if (error) {
        const code = CHOOSE_ERRORS[error.message];
        if (code) throw new ChooseError(code, error.message);
        throw new Error(`online_refund_choose failed: ${error.message}`);
      }
      const d = data as {
        refund_id: string;
        order_ref: string;
        choice: RefundChoice;
        status: RefundStatus;
        vouchers: Voucher[];
        credit_added: number;
        gateway_legs: { leg_id: string; amount: number }[];
      };
      return {
        refundId: d.refund_id,
        orderRef: d.order_ref,
        choice: d.choice,
        status: d.status,
        vouchers: d.vouchers.map((v) => ({ code: v.code, value: num(v.value), expiry: v.expiry })),
        creditAdded: num(d.credit_added),
        gatewayLegs: d.gateway_legs.map((l) => ({ legId: l.leg_id, orderRef: d.order_ref, amount: num(l.amount) })),
      };
    },
    async defaultExpired() {
      return await rpc<string[]>(client, "online_refund_default_expired", {});
    },
    async openLegs(refundId) {
      const rows = await rpc<{ leg_id: string; order_ref: string; amount: number }[]>(
        client,
        "online_refund_open_legs",
        { p_refund_id: refundId },
      );
      return rows.map((r) => ({ legId: r.leg_id, orderRef: r.order_ref, amount: num(r.amount) }));
    },
    async legsDue() {
      const rows = await rpc<
        {
          leg_id: string;
          refund_id: string;
          order_ref: string;
          amount: number;
          cf_refund_id: string | null;
          action: "submit" | "poll";
        }[]
      >(client, "online_refund_legs_due", {});
      return rows.map((r) => ({
        legId: r.leg_id,
        refundId: r.refund_id,
        orderRef: r.order_ref,
        amount: num(r.amount),
        cfRefundId: r.cf_refund_id,
        action: r.action,
      }));
    },
    async setLegStatus(legId, status, cfRefundId, note) {
      await rpc<null>(client, "online_refund_set_status", {
        p_leg_id: legId,
        p_status: status,
        p_cf_refund_id: cfRefundId,
        p_note: note,
      });
    },
    async setProblem(orderRef, problem) {
      await rpc<null>(client, "online_order_set_problem", { p_order_ref: orderRef, p_problem: problem });
    },
    async notice(refundId) {
      return await rpc<RefundNotice | null>(client, "online_refund_notice", { p_refund_id: refundId });
    },
    async rateLimited(ipHash) {
      return await rpc<boolean>(client, "online_refund_rate_limited", { p_ip_hash: ipHash });
    },
    async recordFailure(ipHash) {
      await rpc<null>(client, "online_refund_record_failure", { p_ip_hash: ipHash });
    },
  };
}
