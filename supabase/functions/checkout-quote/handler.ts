/**
 * POST checkout-quote (plan Task 4; HTTP contract). Read-only pricing of a
 * cart: never writes an order. Answers while checkout_live is false too
 * (with `live: false`), because create-order is the gate that refuses.
 */

import { hashIp, optionalUser } from "../_shared/http.ts";
import { type AppDeps, browserEndpoint, readJsonBody } from "../_shared/context.ts";
import {
  buildQuote,
  optionalString,
  parseCredit,
  parseFulfilment,
  parseItems,
  type QuoteResponse,
} from "../_shared/quote.ts";

export function handler(req: Request, deps: AppDeps): Promise<Response> {
  return browserEndpoint(req, deps.env.allowedOrigins, "checkout_quote", async (): Promise<QuoteResponse> => {
    const body = await readJsonBody(req);
    const items = parseItems(body.items);
    const pincode = optionalString(body.pincode, "pincode");
    const code = optionalString(body.code, "code");
    const creditRequested = parseCredit(body.creditRequested);
    const fulfilment = parseFulfilment(body.fulfilment);
    const user = await optionalUser(req, deps.verifyJwt, deps.env.anonKey ? [deps.env.anonKey] : []);
    const ipHash = deps.env.ipHashSalt ? await hashIp(req, deps.env.ipHashSalt) : null;
    const result = await buildQuote(
      deps,
      { items, pincode, code, creditRequested, phone: null, fulfilment },
      { authUserId: user?.id ?? null, ipHash },
    );
    return result.response;
  });
}
