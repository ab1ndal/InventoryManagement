// Deploy: supabase functions deploy cart-hold --no-verify-jwt
// (guests call it with the anon key; the handler verifies an optional user JWT itself).
import { appDeps } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const deps = appDeps();
Deno.serve((req) => handler(req, deps));
