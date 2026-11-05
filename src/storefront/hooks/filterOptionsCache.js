import { supabase } from "lib/supabaseClient";

// The filter vocabularies change rarely and every shop, collection and search page asks for them,
// so one answer is reused for this long. Only successes are kept: a failed call must be retried.
export const FILTER_OPTIONS_TTL_MS = 10 * 60 * 1000;

let cached = null; // { result, expires }

export async function fetchFilterOptions() {
  if (cached && Date.now() < cached.expires) return cached.result;
  const result = await supabase.rpc("get_shop_filter_options");
  if (!result.error && result.data) {
    cached = { result, expires: Date.now() + FILTER_OPTIONS_TTL_MS };
  }
  return result;
}

export function clearFilterOptionsCache() {
  cached = null;
}
