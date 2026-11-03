const REST_TIMEOUT_MS = 3000;

// Queries as the anonymous storefront, so RLS decides what is public. Throws on failure.
export function restClient(url, anonKey) {
  return async (query) => {
    const res = await fetch(`${url}/rest/v1/${query}`, {
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(REST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`PostgREST ${res.status} for ${query.slice(0, 80)}`);
    return res.json();
  };
}
