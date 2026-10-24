// Deploy: supabase functions deploy cashfree-webhook --no-verify-jwt
// (Cashfree sends no JWT; the HMAC signature is checked inside the handler).
import { appDeps } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const deps = appDeps();
Deno.serve((req) => handler(req, deps));
