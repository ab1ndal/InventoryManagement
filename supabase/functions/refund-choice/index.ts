/**
 * POST refund-choice (public, deploy with --no-verify-jwt). Contract:
 * docs/superpowers/plans/2026-10-23-online-orders-http-contracts.md
 *   { token, action: "preview" }                         → RefundPreview
 *   { token, action: "choose", choice: "store_credit"|"original" }
 *                                                        → { status, choice, vouchers, creditAdded }
 * The token is the capability (64 random hex chars, 48 h); no JWT needed.
 * Unknown tokens count as failures per hashed IP (10/hour → 429 rate_limited).
 * "original": the choice is recorded by the DB first, then each gateway leg goes
 * to Cashfree; a Cashfree failure does not fail the request, the sweeper retries.
 */

import { corsHeaders, handlePreflight, hashIp, json, parseAllowedOrigins, serviceClient } from "../_shared/http.ts";
import type { CashfreeClient } from "../_shared/cashfree.ts";
import {
  cashfreeFromEnv,
  ChooseError,
  jsonLog,
  type Log,
  type RefundChoice,
  type RefundDb,
  submitGatewayLegs,
  supabaseRefundDb,
} from "../_shared/refunds.ts";

export type Deps = {
  db: RefundDb;
  cashfree: CashfreeClient | null;
  allowedOrigins: string[];
  ipSalt: string;
  now: () => Date;
  log: Log;
};

const TOKEN_RE = /^[A-Za-z0-9]{16,128}$/;
const CHOICES: RefundChoice[] = ["store_credit", "original"];

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const preflight = handlePreflight(req, deps.allowedOrigins);
  if (preflight) return preflight;
  const cors = corsHeaders(req, deps.allowedOrigins);
  const fail = (status: number, error: string, code: string) => json(status, { error, code }, cors);
  if (req.method !== "POST") return fail(405, "method not allowed", "method_not_allowed");

  let body: { token?: unknown; action?: unknown; choice?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "body must be JSON", "bad_request");
  }
  if (body === null || typeof body !== "object") return fail(400, "body must be an object", "bad_request");
  const { action, choice } = body;
  if (action !== "preview" && action !== "choose") return fail(400, "unknown action", "bad_request");
  if (action === "choose" && !CHOICES.includes(choice as RefundChoice)) {
    return fail(400, "choice must be store_credit or original", "bad_request");
  }

  try {
    const ipHash = await hashIp(req, deps.ipSalt);
    if (await deps.db.rateLimited(ipHash)) return fail(429, "too many attempts, try again later", "rate_limited");

    const token = typeof body.token === "string" ? body.token : "";
    const invalid = async () => {
      await deps.db.recordFailure(ipHash);
      return fail(404, "This refund link isn't valid.", "invalid_token");
    };
    if (!TOKEN_RE.test(token)) return await invalid();

    if (action === "preview") {
      const p = await deps.db.preview(token);
      if (!p) return await invalid();
      if (p.status === "awaiting_choice" && new Date(p.expiresAt).getTime() <= deps.now().getTime()) {
        return fail(410, "This refund link has expired.", "expired");
      }
      return json(200, p, cors);
    }

    let res;
    try {
      res = await deps.db.choose(token, choice as RefundChoice);
    } catch (err) {
      if (!(err instanceof ChooseError)) throw err;
      if (err.code === "invalid_token") return await invalid();
      if (err.code === "already_chosen") {
        return fail(409, "A choice was already made for this refund.", "already_chosen");
      }
      if (err.code === "expired") return fail(410, "This refund link has expired.", "expired");
      return fail(400, "choice must be store_credit or original", "bad_request");
    }
    deps.log("refund_choice", { refundId: res.refundId, orderRef: res.orderRef, choice: res.choice });

    if (res.gatewayLegs.length > 0) {
      if (deps.cashfree) {
        await submitGatewayLegs({ db: deps.db, cashfree: deps.cashfree, log: deps.log }, res.gatewayLegs);
      } else {
        deps.log("refund_cashfree_not_configured", { refundId: res.refundId, legs: res.gatewayLegs.length });
      }
    }
    return json(
      200,
      { status: res.status, choice: res.choice, vouchers: res.vouchers, creditAdded: res.creditAdded },
      cors,
    );
  } catch (err) {
    deps.log("refund_choice_error", { action, error: err instanceof Error ? err.message : String(err) });
    return fail(500, "Something went wrong, please try again.", "internal");
  }
}

function realDeps(): Deps {
  const env = (k: string) => Deno.env.get(k)?.trim() ?? "";
  const ipSalt = env("IP_HASH_SALT");
  if (!ipSalt) throw new Error("IP_HASH_SALT not set");
  return {
    db: supabaseRefundDb(serviceClient()),
    cashfree: cashfreeFromEnv(),
    allowedOrigins: parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGIN")),
    ipSalt,
    now: () => new Date(),
    log: jsonLog,
  };
}

if (import.meta.main) {
  const deps = realDeps();
  Deno.serve((req) => handler(req, deps));
}
