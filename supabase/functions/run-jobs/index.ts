// Deploy: supabase functions deploy run-jobs --no-verify-jwt
// (pg_cron sends only x-cron-secret; the handler also accepts the service-role bearer).
import { appDeps, jobContext } from "../_shared/context.ts";
import { handler } from "./handler.ts";

const base = appDeps();
const deps = { ...base, jobContext: jobContext(base) };
Deno.serve((req) => handler(req, deps));
