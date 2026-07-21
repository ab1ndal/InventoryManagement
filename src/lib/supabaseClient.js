import { createClient } from "@supabase/supabase-js";
import { makeSupabaseFetch } from "./supabaseFetch";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY;

// Route PostgREST reads through a same-origin proxy so the browser never holds
// Cloudflare's `__cf_bm` cookie for supabase.co (which, when stale, hangs
// background fetches forever). See src/lib/supabaseFetch.js for the mechanism.
const isProd = process.env.NODE_ENV === "production";
const origin = typeof window !== "undefined" ? window.location.origin : "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: makeSupabaseFetch({ isProd, origin }) },
});