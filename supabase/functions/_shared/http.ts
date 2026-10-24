/**
 * HTTP plumbing shared by Edge Functions (plan R11, R9).
 *
 * CORS: browser-facing functions echo `Origin` only on an exact match
 * against ALLOWED_ORIGIN (comma list). No wildcard, no credentials, and
 * `Vary: Origin` always. Webhooks don't use CORS at all.
 *
 * Identity: `optionalUser` returns null when no user token is sent and
 * throws 401 when one is sent but doesn't verify, so a forged/expired token
 * never silently downgrades to a guest. supabase-js `functions.invoke`
 * sends the project's public (anon/publishable) key as the bearer when
 * nobody is signed in; pass those keys in `publicKeys` so that case counts
 * as "absent".
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export type VerifiedUser = { id: string };
export type VerifyJwt = (jwt: string) => Promise<VerifiedUser | null>;

const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const ALLOW_METHODS = "GET, POST, OPTIONS";

export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "").split(",").map((o) => o.trim()).filter(Boolean);
}

export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  const origin = req.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = ALLOW_HEADERS;
    headers["Access-Control-Allow-Methods"] = ALLOW_METHODS;
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

/** Response for an OPTIONS preflight, or null for any other method. */
export function handlePreflight(req: Request, allowedOrigins: string[]): Response | null {
  if (req.method !== "OPTIONS") return null;
  const headers = corsHeaders(req, allowedOrigins);
  const allowed = "Access-Control-Allow-Origin" in headers;
  return new Response(null, { status: allowed ? 204 : 403, headers });
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}

function bearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!m) throw new HttpError(401, "invalid authorization header");
  return m[1];
}

export async function optionalUser(
  req: Request,
  verify: VerifyJwt,
  publicKeys: string[] = [],
): Promise<VerifiedUser | null> {
  const token = bearer(req);
  if (token === null || publicKeys.includes(token)) return null;
  const user = await verify(token);
  if (!user) throw new HttpError(401, "invalid or expired session");
  return user;
}

export async function requireAdmin(
  req: Request,
  verify: VerifyJwt,
  isAdmin: (userId: string) => Promise<boolean>,
  publicKeys: string[] = [],
): Promise<VerifiedUser> {
  const user = await optionalUser(req, verify, publicKeys);
  if (!user) throw new HttpError(401, "sign-in required");
  if (!(await isAdmin(user.id))) throw new HttpError(403, "admin access required");
  return user;
}

/**
 * SHA-256 hex of the first x-forwarded-for hop + salt, for rate limiting
 * without storing raw IPs (R9). null when the header is absent.
 */
export async function hashIp(req: Request, salt: string): Promise<string | null> {
  if (!salt) throw new Error("hashIp: salt is required");
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (!ip) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Service-role client; bypasses RLS, so only Edge Functions use it. */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** VerifyJwt backed by supabase.auth.getUser (checks the token with Auth). */
export function supabaseVerifier(client: SupabaseClient): VerifyJwt {
  return async (jwt) => {
    const { data, error } = await client.auth.getUser(jwt);
    if (error || !data.user) return null;
    return { id: data.user.id };
  };
}

/** Same rule as RequireAdminAuth: role admin/superadmin and not deactivated. */
export function profileAdminCheck(client: SupabaseClient): (userId: string) => Promise<boolean> {
  return async (userId) => {
    const { data, error } = await client
      .from("profiles")
      .select("role, is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(`profiles lookup failed: ${error.message}`);
    return !!data && ["admin", "superadmin"].includes(data.role) && data.is_active !== false;
  };
}
