import { toProxyUrl, makeSupabaseFetch } from "../supabaseFetch";

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL;
const REST = `${SUPABASE_URL}/rest/v1`;
const ORIGIN = "https://bindalscreations.com";

describe("toProxyUrl", () => {
  test("rewrites REST URL to same-origin proxy in production", () => {
    expect(
      toProxyUrl(`${REST}/products?select=productid`, {
        isProd: true,
        origin: ORIGIN,
      })
    ).toBe(`${ORIGIN}/sb-rest/products?select=productid`);
  });

  test("rewrites rpc calls too (they live under /rest/v1)", () => {
    expect(
      toProxyUrl(`${REST}/rpc/get_distinct_sizes`, {
        isProd: true,
        origin: ORIGIN,
      })
    ).toBe(`${ORIGIN}/sb-rest/rpc/get_distinct_sizes`);
  });

  test("passes REST URL through untouched in dev", () => {
    const u = `${REST}/products?select=productid`;
    expect(toProxyUrl(u, { isProd: false, origin: ORIGIN })).toBe(u);
  });

  test("rewrites auth API URL to same-origin proxy in production", () => {
    expect(
      toProxyUrl(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        isProd: true,
        origin: ORIGIN,
      })
    ).toBe(`${ORIGIN}/sb-auth/token?grant_type=refresh_token`);
  });

  test("passes auth URL through untouched in dev", () => {
    const u = `${SUPABASE_URL}/auth/v1/token?grant_type=otp`;
    expect(toProxyUrl(u, { isProd: false, origin: ORIGIN })).toBe(u);
  });

  test("never proxies storage URLs", () => {
    const u = `${SUPABASE_URL}/storage/v1/object/public/mockups/a.png`;
    expect(toProxyUrl(u, { isProd: true, origin: ORIGIN })).toBe(u);
  });
});

describe("makeSupabaseFetch", () => {
  const ok = () => Promise.resolve({ status: 200 });

  test("routes REST GET through the same-origin proxy in prod", async () => {
    const spy = jest.fn(ok);
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    await f(`${REST}/products?select=productid`, { method: "GET" });
    expect(spy).toHaveBeenCalledWith(
      `${ORIGIN}/sb-rest/products?select=productid`,
      expect.objectContaining({ method: "GET" })
    );
  });

  test("routes auth requests through the proxy with a timeout signal", async () => {
    const spy = jest.fn(ok);
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    await f(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
    });
    const [calledUrl, calledInit] = spy.mock.calls[0];
    expect(calledUrl).toBe(`${ORIGIN}/sb-auth/token?grant_type=refresh_token`);
    expect(calledInit.signal).toBeInstanceOf(AbortSignal);
  });

  test("aborts a hung auth request after the timeout", async () => {
    // Never resolves on its own; only settles when our signal aborts it.
    const hang = (_url, init) =>
      new Promise((_res, rej) =>
        init.signal.addEventListener("abort", () => rej(new Error("aborted")))
      );
    const f = makeSupabaseFetch({
      isProd: true,
      origin: ORIGIN,
      timeoutMs: 10,
      fetchImpl: hang,
    });
    await expect(
      f(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
      })
    ).rejects.toThrow("aborted");
  });

  test("does not add a timeout signal to REST writes (non-idempotent)", async () => {
    const spy = jest.fn(ok);
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    await f(`${REST}/products`, { method: "POST", body: "{}" });
    expect(spy.mock.calls[0][1].signal).toBeUndefined();
  });

  test("attaches an abort signal to guarded REST GETs", async () => {
    const spy = jest.fn(ok);
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    await f(`${REST}/products?select=x`, { method: "GET" });
    expect(spy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  test("retries a failed REST GET once, then succeeds", async () => {
    const spy = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: 200 });
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    const res = await f(`${REST}/products?select=x`, { method: "GET" });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("does not retry auth failures", async () => {
    const spy = jest.fn().mockRejectedValue(new Error("boom"));
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    await expect(
      f(`${SUPABASE_URL}/auth/v1/token`, { method: "POST" })
    ).rejects.toThrow("boom");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("respects a caller-supplied AbortSignal (skips our timeout wrapper)", async () => {
    const spy = jest.fn(ok);
    const f = makeSupabaseFetch({ isProd: true, origin: ORIGIN, fetchImpl: spy });
    const ac = new AbortController();
    await f(`${REST}/products?select=x`, { method: "GET", signal: ac.signal });
    expect(spy.mock.calls[0][1].signal).toBe(ac.signal);
  });
});
