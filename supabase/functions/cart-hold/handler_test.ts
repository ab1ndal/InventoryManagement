import { assert, assertEquals } from "@std/assert";
import { handler, parseHoldItems } from "./handler.ts";
import { ApiError } from "../_shared/context.ts";
import { hashIp } from "../_shared/http.ts";
import { FakeStore, ORIGIN, post, testDeps, testEnv, USER, V1, V2 } from "../_shared/pay_testing.ts";

const URL_ = "https://fn.test/cart-hold";
const G = "g:55555555-5555-4555-8555-555555555555";

type Hold = { holder: string; variant: string; qty: number; ip: string | null };

/**
 * In-memory stand-in for stock_hold_set's contract (the real rules are tested in
 * schema/test_online_orders_holds.sql): stock − others' holds, 5 per holder,
 * 10 per IP, replace releases unlisted, rateLimitAfter calls → rate_limited.
 */
function holdDb(stock: Record<string, number>, rateLimitAfter = Infinity) {
  const holds: Hold[] = [];
  let calls = 0;
  const store = new FakeStore();
  store.impls.stock_hold_adopt = (a) => {
    for (const h of holds) if (h.holder === a.p_from) h.holder = String(a.p_to);
    return 1;
  };
  store.impls.stock_hold_set = (a) => {
    const holder = String(a.p_holder);
    const ip = (a.p_ip_hash as string | null) ?? null;
    if (++calls > rateLimitAfter) return { rate_limited: true, items: [], expires_at: "2026-10-23T10:15:00Z" };
    const items = a.p_items as { variant_id: string; qty: number }[];
    if (a.p_replace) {
      for (let i = holds.length - 1; i >= 0; i--) {
        if (holds[i].holder === holder && !items.some((x) => x.variant_id === holds[i].variant)) holds.splice(i, 1);
      }
    }
    const out = items.map(({ variant_id: v, qty }) => {
      const sum = (f: (h: Hold) => boolean) => holds.filter(f).reduce((s, h) => s + h.qty, 0);
      const available = Math.max((stock[v] ?? 0) - sum((h) => h.variant === v && h.holder !== holder), 0);
      const holderRoom = 5 - sum((h) => h.holder === holder && h.variant !== v);
      const ipRoom = ip === null ? qty : 10 - sum((h) => h.ip === ip && !(h.holder === holder && h.variant === v));
      const held = qty === 0 ? 0 : Math.max(Math.min(qty, available, holderRoom, ipRoom), 0);
      const reason = held < qty ? (held === available ? "unavailable" : held === holderRoom ? "holder_cap" : "ip_cap") : null;
      const idx = holds.findIndex((h) => h.holder === holder && h.variant === v);
      if (idx >= 0) holds.splice(idx, 1);
      if (held > 0) holds.push({ holder, variant: v, qty: held, ip });
      return { variant_id: v, requested: qty, held, available, reason, expires_at: held ? "2026-10-23T10:15:00Z" : null };
    });
    return {
      rate_limited: false,
      items: out,
      expires_at: holds.some((h) => h.holder === holder) ? "2026-10-23T10:15:00Z" : null,
    };
  };
  return { store, holds };
}

async function call(store: FakeStore, body: unknown, headers: Record<string, string> = {}) {
  const res = await handler(post(URL_, body, headers), testDeps({ store }));
  return { res, json: await res.json() };
}

Deno.test("cart-hold: guest holds with its key; contract shape; CORS", async () => {
  const { store, holds } = holdDb({ [V1]: 3 });
  const { res, json } = await call(store, { holderKey: G.toUpperCase().replace("G:", "g:"), items: [{ variantId: V1, qty: 2 }] });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ORIGIN);
  assertEquals(json, {
    rateLimited: false,
    items: [{ variantId: V1, requested: 2, held: 2, available: 3, reason: null }],
    expiresAt: "2026-10-23T10:15:00Z",
  });
  const [set] = store.callsTo("stock_hold_set");
  assertEquals([set.p_holder, set.p_items, set.p_replace], [G, [{ variant_id: V1, qty: 2 }], false]);
  assertEquals(holds, [{ holder: G, variant: V1, qty: 2, ip: set.p_ip_hash as string }]);
  assertEquals(store.callsTo("stock_hold_adopt"), [], "no adopt for a guest");
});

Deno.test("cart-hold: signed-in holder key comes from the JWT; a sent guest key is adopted, never trusted as u:", async () => {
  const { store, holds } = holdDb({ [V1]: 3 });
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }] });
  const { json } = await call(store, { holderKey: G, items: [{ variantId: V1, qty: 2 }] }, { authorization: "Bearer user.jwt" });
  assertEquals(store.callsTo("stock_hold_adopt"), [{ p_from: G, p_to: `u:${USER}` }]);
  assertEquals(store.callsTo("stock_hold_set")[1].p_holder, `u:${USER}`);
  assertEquals(json.items[0].held, 2, "own (adopted) hold is not someone else's");
  assertEquals(holds.map((h) => h.holder), [`u:${USER}`]);
  // a client can't name a user key
  const forged = await call(store, { holderKey: `u:${USER}`, items: [{ variantId: V1, qty: 1 }] });
  assertEquals([forged.res.status, forged.json.code], [400, "bad_request"]);
  // a forged JWT is a 401, never a silent guest
  assertEquals((await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }] }, { authorization: "Bearer forged" })).res.status, 401);
});

Deno.test("cart-hold: others' holds cap what this shopper gets (reason unavailable)", async () => {
  const { store } = holdDb({ [V1]: 1 });
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }] });
  const other = "g:66666666-6666-4666-8666-666666666666";
  const { json } = await call(store, { holderKey: other, items: [{ variantId: V1, qty: 1 }] });
  assertEquals(json.items, [{ variantId: V1, requested: 1, held: 0, available: 0, reason: "unavailable" }]);
  assertEquals(json.expiresAt, null);
});

Deno.test("cart-hold: holder cap and IP cap return held < requested with a reason (200, not an error)", async () => {
  const { store } = holdDb({ [V1]: 20, [V2]: 20 });
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 4 }] });
  const capped = await call(store, { holderKey: G, items: [{ variantId: V2, qty: 3 }] });
  assertEquals([capped.res.status, capped.json.items[0].held, capped.json.items[0].reason], [200, 1, "holder_cap"]);

  const { store: s2 } = holdDb({ [V1]: 20 });
  const key = (n: number) => `g:7777777${n}-7777-4777-8777-777777777777`;
  for (const n of [1, 2]) await call(s2, { holderKey: key(n), items: [{ variantId: V1, qty: 5 }] });
  const ipCapped = await call(s2, { holderKey: key(3), items: [{ variantId: V1, qty: 2 }] });
  assertEquals([ipCapped.json.items[0].held, ipCapped.json.items[0].reason], [0, "ip_cap"]);
});

Deno.test("cart-hold: IP hash prefers cf-connecting-ip; no salt → no IP hash (IP cap off)", async () => {
  const { store } = holdDb({ [V1]: 3 });
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }] }, { "cf-connecting-ip": "9.9.9.9" });
  const expected = await hashIp(post(URL_, {}, { "x-forwarded-for": "9.9.9.9" }), testEnv.ipHashSalt);
  assertEquals(store.callsTo("stock_hold_set")[0].p_ip_hash, expected);

  const { store: s2 } = holdDb({ [V1]: 3 });
  const res = await handler(
    post(URL_, { holderKey: G, items: [{ variantId: V1, qty: 1 }] }),
    testDeps({ store: s2, env: { ...testEnv, ipHashSalt: "" } }),
  );
  assertEquals(res.status, 200);
  assertEquals(s2.callsTo("stock_hold_set")[0].p_ip_hash, null);
});

Deno.test("cart-hold: qty 0 releases; replace renews the listed holds and releases the rest; [] + replace clears", async () => {
  const { store, holds } = holdDb({ [V1]: 3, [V2]: 3 });
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }] });
  await call(store, { holderKey: G, items: [{ variantId: V2, qty: 0 }] });
  assertEquals(holds.map((h) => h.variant), [V1], "qty 0 released V2");
  await call(store, { holderKey: G, items: [{ variantId: V2, qty: 2 }], replace: true });
  assertEquals(holds.map((h) => [h.variant, h.qty]), [[V2, 2]], "sync released V1");
  assertEquals(store.callsTo("stock_hold_set")[2].p_replace, true);
  const { json } = await call(store, { holderKey: G, items: [], replace: true });
  assertEquals([holds.length, json.expiresAt], [0, null]);
});

Deno.test("cart-hold: rate limited → 200 rateLimited, items []", async () => {
  const { store } = holdDb({ [V1]: 3 }, 1);
  await call(store, { holderKey: G, items: [{ variantId: V1, qty: 1 }] });
  const { res, json } = await call(store, { holderKey: G, items: [{ variantId: V1, qty: 2 }] });
  assertEquals([res.status, json], [200, { rateLimited: true, items: [], expiresAt: "2026-10-23T10:15:00Z" }]);
});

Deno.test("cart-hold: bad input → 400 (no key as guest, bad key, empty items without replace, bad qty)", async () => {
  const { store } = holdDb({ [V1]: 3 });
  for (
    const b of [
      { items: [{ variantId: V1, qty: 1 }] },
      { holderKey: "g:nope", items: [{ variantId: V1, qty: 1 }] },
      { holderKey: G, items: [] },
      { holderKey: G, items: [{ variantId: V1, qty: 1 }], replace: "yes" },
      { holderKey: G, items: [{ variantId: V1, qty: 21 }] },
    ]
  ) {
    const { res, json } = await call(store, b);
    assertEquals([res.status, json.code], [400, "bad_request"], JSON.stringify(b));
  }
  assertEquals(store.callsTo("stock_hold_set"), []);
});

Deno.test("parseHoldItems: last quantity wins for a repeated variant; caps the count", () => {
  assertEquals(parseHoldItems([{ variantId: V1, qty: 2 }, { variantId: V1.toUpperCase(), qty: 0 }]), [{ variantId: V1, qty: 0 }]);
  const many = Array.from({ length: 31 }, (_, i) => ({ variantId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, qty: 1 }));
  let err: unknown;
  try {
    parseHoldItems(many);
  } catch (e) {
    err = e;
  }
  assert(err instanceof ApiError && err.status === 400);
});

Deno.test("cart-hold: OPTIONS preflight and non-POST", async () => {
  const pre = await handler(new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }), testDeps());
  assertEquals(pre.status, 204);
  const get = await handler(new Request(URL_, { method: "GET", headers: { origin: ORIGIN } }), testDeps());
  assertEquals(get.status, 405);
  await get.body?.cancel();
});
