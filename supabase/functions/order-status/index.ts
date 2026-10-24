// Deploy: supabase functions deploy order-status --no-verify-jwt
// (access is checked by token or by the owner's JWT inside the handler; R10/R11).
import { appDeps } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const deps = appDeps();
Deno.serve((req) => handler(req, deps));
