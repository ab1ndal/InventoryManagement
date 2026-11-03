// Deploy: supabase functions deploy order-packed-photos --no-verify-jwt
// (access is checked by order number and phone inside the handler).
import { appDeps } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const deps = appDeps();
Deno.serve((req) => handler(req, deps));
