// Deploy: supabase functions deploy create-order --no-verify-jwt
// (the handler verifies the optional user JWT itself; R11).
import { appDeps } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const deps = appDeps();
Deno.serve((req) => handler(req, deps));
