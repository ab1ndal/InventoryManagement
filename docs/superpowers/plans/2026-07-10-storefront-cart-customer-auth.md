# Storefront Cart Page + Customer Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a full `/cart` page with live stock/price revalidation, email-magic-link customer login, server-side cart persistence, and identity reconciliation with the in-store `customers` record.

**Architecture:** Reuse the existing `cart_items` table (RLS `auth.uid()=user_id`). Customer identity reconciles with `customers` through two `SECURITY DEFINER` RPCs (table RLS stays admin-only). `CartContext` becomes auth-aware and subscribes to `supabase.auth` directly for event granularity; a separate `StorefrontAuthContext` drives login UI. Guest localStorage cart is untouched.

**Tech Stack:** React 19 (CRA), react-router-dom, `@supabase/supabase-js`, Tailwind (storefront tokens), Jest + React Testing Library, sonner (toasts), lucide-react.

## Global Constraints

- Storefront uses the Supabase **anon key** only; no secrets client-side. Auth issues a user JWT so RLS applies.
- `customers` table RLS stays `admin_only`; customer access flows **only** through `SECURITY DEFINER` RPCs that trust `auth.uid()`/`auth.email()`, never client-supplied identity.
- Unverified phone must never claim a `customers` row with `store_credit > 0` or a non-null `email`.
- Cart merge on login = **max per variant, capped at live stock**, and runs **only on the `SIGNED_IN` event** (not `INITIAL_SESSION`/`TOKEN_REFRESHED`).
- Customers (`role='user'`) see no admin UI; account menu links only to `/account`, `/account/orders`, sign-out.
- Real checkout/payment is out of scope; `/cart` terminal action is a disabled button + a `wa.me` order fallback.
- Test command: `CI=true npx react-scripts test --watchAll=false <path>`.
- Storefront item shape (canonical, used everywhere): `{ variant_id, product_id, quantity, name, size, color, price, image_url }`.

---

### Task 1: Customer-auth migration (link column + reconciliation RPCs)

**Files:**
- Create: `schema/migration_storefront_customer_auth.sql`
- Test: `schema/test_storefront_customer_auth.sql` (assertions, run against linked DB)

**Interfaces:**
- Produces (callable via `supabase.rpc(...)` by authenticated users):
  - `resolve_my_customer()` → returns one row `{ customerid, customer_ulid, first_name, last_name, phone, email, address, gender, needs_review boolean }`.
  - `update_my_customer(p_first_name text, p_last_name text, p_phone text, p_address text, p_gender text)` → returns the same row shape.

- [ ] **Step 1: Write the migration SQL**

Create `schema/migration_storefront_customer_auth.sql`:

```sql
-- Storefront customer auth: link auth.users to the in-store customers record
-- and expose safe, verified-identity-only reconciliation RPCs. The customers
-- table RLS stays admin_only; these SECURITY DEFINER functions are the only
-- customer-facing gateway.

alter table public.customers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Shared return type: a customer projection plus a needs_review flag telling
-- the client an ambiguous/guarded case was routed to admin follow-up.
create or replace function public._customer_projection(c public.customers, p_needs_review boolean)
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language sql immutable as $$
  select c.customerid, c.customer_ulid, c.first_name, c.last_name,
         c.phone, c.email, c.address, c.gender, p_needs_review;
$$;

-- Resolve (or create) the caller's customer row using their VERIFIED email.
create or replace function public.resolve_my_customer()
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_match_count int;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 1. Already linked.
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if found then
    return query select * from public._customer_projection(v_row, false);
    return;
  end if;

  -- 2. Exactly one row matching the verified email -> link it.
  select count(*) into v_match_count from public.customers where lower(email) = lower(v_email);
  if v_match_count = 1 then
    update public.customers set auth_user_id = v_uid
      where lower(email) = lower(v_email) returning * into v_row;
    return query select * from public._customer_projection(v_row, false);
    return;
  elsif v_match_count > 1 then
    v_needs_review := true;  -- ambiguous; fall through to create a clean row
  end if;

  -- 3/4. Create a fresh linked row (placeholder name from email local-part).
  insert into public.customers (first_name, customer_ulid, email, auth_user_id, is_guest)
  values (
    split_part(coalesce(v_email, 'customer'), '@', 1),
    replace(gen_random_uuid()::text, '-', ''),
    v_email, v_uid, false
  )
  returning * into v_row;

  if v_needs_review then
    update public.customers
      set customer_notes = concat_ws(E'\n', customer_notes,
        '[' || current_date || '] online signup: multiple in-store records share this email; needs manual merge')
      where customerid = v_row.customerid returning * into v_row;
  end if;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$$;

-- Update the caller's own row. Guarded phone match: if the caller is on a
-- freshly created row (no in-store history: store_credit=0 and no phone yet)
-- and the typed phone matches exactly one OTHER unlinked, email-less,
-- zero-credit record, re-link the caller to that record (safe reclaim).
create or replace function public.update_my_customer(
  p_first_name text, p_last_name text, p_phone text, p_address text, p_gender text
)
returns table (
  customerid int, customer_ulid varchar, first_name varchar, last_name varchar,
  phone varchar, email varchar, address text, gender varchar, needs_review boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_target public.customers;
  v_reclaim_count int;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Ensure the caller has a row (reuse resolve logic).
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if not found then
    perform public.resolve_my_customer();
    select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  end if;

  -- Guarded phone reclaim (only from a fresh row, only to a safe target).
  if p_phone is not null and p_phone <> ''
     and coalesce(v_row.store_credit, 0) = 0 and (v_row.phone is null or v_row.phone = '') then
    select count(*) into v_reclaim_count from public.customers t
      where t.phone = p_phone and t.auth_user_id is null
        and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
        and t.customerid <> v_row.customerid;
    if v_reclaim_count = 1 then
      select * into v_target from public.customers t
        where t.phone = p_phone and t.auth_user_id is null
          and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
          and t.customerid <> v_row.customerid limit 1;
      -- auth_user_id is UNIQUE, so the just-created placeholder must be removed
      -- before the in-store record can take the caller's identity. The
      -- placeholder is fresh with no dependents (cart_items FK auth.users, not
      -- customers; orders table does not exist yet), so deleting it is safe.
      delete from public.customers where customerid = v_row.customerid;
      update public.customers set auth_user_id = v_uid, email = v_email
        where customerid = v_target.customerid returning * into v_row;
    else
      -- A matching record exists but is not safe to auto-claim.
      if exists (select 1 from public.customers t where t.phone = p_phone
                 and (coalesce(t.store_credit,0) > 0 or t.email is not null)
                 and t.customerid <> v_row.customerid) then
        v_needs_review := true;
      end if;
    end if;
  end if;

  update public.customers set
    first_name = coalesce(nullif(p_first_name,''), first_name),
    last_name  = coalesce(p_last_name, last_name),
    phone      = coalesce(nullif(p_phone,''), phone),
    address    = coalesce(p_address, address),
    gender     = coalesce(p_gender, gender),
    customer_notes = case when v_needs_review then
        concat_ws(E'\n', customer_notes,
          '[' || current_date || '] online: typed phone matches a protected in-store record; needs manual merge')
      else customer_notes end
  where customerid = v_row.customerid returning * into v_row;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$$;

revoke all on function public.resolve_my_customer() from public, anon;
revoke all on function public.update_my_customer(text,text,text,text,text) from public, anon;
grant execute on function public.resolve_my_customer() to authenticated;
grant execute on function public.update_my_customer(text,text,text,text,text) to authenticated;
```

- [ ] **Step 2: Apply the migration to the linked database**

This is a live-DB change (single Supabase project, no separate dev DB). It is additive and backward-compatible (nullable column + new functions).

Run: `supabase db query --linked -f schema/migration_storefront_customer_auth.sql`
Expected: no error; functions created.

- [ ] **Step 3: Write SQL assertions**

Create `schema/test_storefront_customer_auth.sql`:

```sql
-- Structural assertions (identity behaviour needs a real authenticated JWT, so
-- exercise it from the app-level integration test in Task 7; here assert shape).
do $$
begin
  assert (select count(*) from information_schema.columns
          where table_name='customers' and column_name='auth_user_id') = 1,
         'customers.auth_user_id missing';
  assert (select count(*) from pg_proc where proname='resolve_my_customer') = 1,
         'resolve_my_customer missing';
  assert (select count(*) from pg_proc where proname='update_my_customer') = 1,
         'update_my_customer missing';
  assert (select prosecdef from pg_proc where proname='resolve_my_customer') = true,
         'resolve_my_customer must be SECURITY DEFINER';
  assert (select has_function_privilege('authenticated','resolve_my_customer()','execute')),
         'authenticated must execute resolve_my_customer';
  assert not (select has_function_privilege('anon','resolve_my_customer()','execute')),
         'anon must NOT execute resolve_my_customer';
end $$;
select 'customer-auth assertions passed' as result;
```

- [ ] **Step 4: Run the assertions**

Run: `supabase db query --linked -f schema/test_storefront_customer_auth.sql`
Expected: `customer-auth assertions passed`

- [ ] **Step 5: Commit**

```bash
git add schema/migration_storefront_customer_auth.sql schema/test_storefront_customer_auth.sql
git commit -m "feat(db): customer auth link + reconciliation RPCs"
```

---

### Task 2: Pure cart logic (`mergeCarts`, `revalidateItems`)

**Files:**
- Create: `src/storefront/lib/cartLogic.js`
- Test: `src/storefront/__tests__/cartLogic.test.js`

**Interfaces:**
- Produces:
  - `mergeCarts(local, server)` → item[]: union by `variant_id`; for a variant in both, keep the item with the **max** quantity (preserve the richer display fields from whichever has them, preferring `server`). No stock knowledge.
  - `revalidateItems(items, liveByVariant)` → `{ items, changes }`. `liveByVariant` is `{ [variant_id]: { stock:number, price:number } }`; a missing key means the variant no longer exists. `changes` is `[{ variant_id, name, type }]` where `type ∈ 'removed'|'capped'|'repriced'`.

- [ ] **Step 1: Write the failing tests**

```js
import { mergeCarts, revalidateItems } from "../lib/cartLogic";

const item = (variant_id, quantity, extra = {}) => ({
  variant_id, product_id: "BC1", quantity, name: "Saree",
  size: "FREE", color: "Red", price: 1000, image_url: null, ...extra,
});

describe("mergeCarts", () => {
  it("unions distinct variants", () => {
    const merged = mergeCarts([item("a", 1)], [item("b", 2)]);
    expect(merged.map((i) => i.variant_id).sort()).toEqual(["a", "b"]);
  });
  it("takes the max quantity for a variant present in both (no double-count)", () => {
    const merged = mergeCarts([item("a", 2)], [item("a", 2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(2);
  });
  it("keeps the higher of differing quantities", () => {
    expect(mergeCarts([item("a", 5)], [item("a", 1)])[0].quantity).toBe(5);
  });
});

describe("revalidateItems", () => {
  it("drops variants missing from live data", () => {
    const { items, changes } = revalidateItems([item("a", 1)], {});
    expect(items).toHaveLength(0);
    expect(changes).toEqual([{ variant_id: "a", name: "Saree", type: "removed" }]);
  });
  it("caps quantity to live stock", () => {
    const { items, changes } = revalidateItems([item("a", 5)], { a: { stock: 2, price: 1000 } });
    expect(items[0].quantity).toBe(2);
    expect(changes).toContainEqual({ variant_id: "a", name: "Saree", type: "capped" });
  });
  it("removes items whose live stock is 0", () => {
    const { items } = revalidateItems([item("a", 1)], { a: { stock: 0, price: 1000 } });
    expect(items).toHaveLength(0);
  });
  it("updates and flags a changed price", () => {
    const { items, changes } = revalidateItems([item("a", 1)], { a: { stock: 9, price: 1200 } });
    expect(items[0].price).toBe(1200);
    expect(changes).toContainEqual({ variant_id: "a", name: "Saree", type: "repriced" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/cartLogic.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/storefront/lib/cartLogic.js`:

```js
// Pure cart transforms — no I/O, unit-tested. Item shape:
// { variant_id, product_id, quantity, name, size, color, price, image_url }

// Union two carts by variant_id, keeping the higher quantity. The local cart is
// usually a stale mirror of the server, so max (not sum) avoids double-counting
// on re-login / app reopen. Display fields prefer the server copy.
export function mergeCarts(local, server) {
  const byId = new Map();
  for (const it of local) byId.set(it.variant_id, { ...it });
  for (const it of server) {
    const existing = byId.get(it.variant_id);
    byId.set(it.variant_id, {
      ...it,
      quantity: Math.max(it.quantity, existing ? existing.quantity : 0),
    });
  }
  return [...byId.values()];
}

// Reconcile cart items against live stock/price. Drops removed/out-of-stock
// variants, caps over-stock quantities, and updates changed prices.
export function revalidateItems(items, liveByVariant) {
  const out = [];
  const changes = [];
  for (const it of items) {
    const live = liveByVariant[it.variant_id];
    if (!live || live.stock <= 0) {
      changes.push({ variant_id: it.variant_id, name: it.name, type: "removed" });
      continue;
    }
    const next = { ...it };
    if (typeof live.price === "number" && live.price !== it.price) {
      next.price = live.price;
      changes.push({ variant_id: it.variant_id, name: it.name, type: "repriced" });
    }
    if (next.quantity > live.stock) {
      next.quantity = live.stock;
      changes.push({ variant_id: it.variant_id, name: it.name, type: "capped" });
    }
    out.push(next);
  }
  return { items: out, changes };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/cartLogic.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/storefront/lib/cartLogic.js src/storefront/__tests__/cartLogic.test.js
git commit -m "feat(cart): pure merge + revalidation logic"
```

---

### Task 3: Server cart data layer (`cartApi.js`)

**Files:**
- Create: `src/storefront/lib/cartApi.js`
- Test: `src/storefront/__tests__/cartApi.test.js`

**Interfaces:**
- Consumes: `supabase` from `lib/supabaseClient`; `getProductImageUrl` from `../lib/productImage`.
- Produces:
  - `fetchServerCart()` → `Promise<item[]>` (joined to live product data, image resolved).
  - `upsertItem({ variant_id, product_id, quantity })` → `Promise<void>`.
  - `removeServerItem(variant_id)` → `Promise<void>`.
  - `clearServerCart()` → `Promise<void>`.
  - `fetchLiveVariantData(items)` → `Promise<{ [variant_id]: { stock, price } }>`.

- [ ] **Step 1: Write the failing test**

Uses a manual mock of the supabase client. Create `src/storefront/__tests__/cartApi.test.js`:

```js
jest.mock("lib/supabaseClient", () => {
  const auth = { getUser: jest.fn(async () => ({ data: { user: { id: "u1" } } })) };
  const api = { auth, _table: null, from: jest.fn() };
  return { supabase: api };
});
jest.mock("../lib/productImage", () => ({
  getProductImageUrl: jest.fn(async () => "img://x"),
}));

import { supabase } from "lib/supabaseClient";
import { upsertItem } from "../lib/cartApi";

describe("cartApi.upsertItem", () => {
  it("upserts with the current user id on the (user_id,variant_id) conflict", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    supabase.from.mockReturnValue({ upsert });
    await upsertItem({ variant_id: "v1", product_id: "BC1", quantity: 3 });
    expect(supabase.from).toHaveBeenCalledWith("cart_items");
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "u1", variant_id: "v1", product_id: "BC1", quantity: 3 },
      { onConflict: "user_id,variant_id" }
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/cartApi.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/storefront/lib/cartApi.js`:

```js
import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../lib/productImage";

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// Read the caller's server cart (RLS scopes rows to auth.uid()), joined to live
// product data, and resolve a thumbnail per line. Returns canonical item shape.
export async function fetchServerCart() {
  const { data, error } = await supabase
    .from("cart_items")
    .select(
      "variant_id, product_id, quantity, productsizecolors(size, color, stock), products(name, retailprice)"
    );
  if (error || !data) return [];
  return Promise.all(
    data.map(async (row) => ({
      variant_id: row.variant_id,
      product_id: row.product_id,
      quantity: row.quantity,
      name: row.products?.name ?? "",
      size: row.productsizecolors?.size ?? "",
      color: row.productsizecolors?.color ?? "",
      price: Number(row.products?.retailprice ?? 0),
      image_url: await getProductImageUrl(row.product_id, { width: 400, quality: 70 }),
    }))
  );
}

export async function upsertItem({ variant_id, product_id, quantity }) {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase
    .from("cart_items")
    .upsert({ user_id, variant_id, product_id, quantity }, { onConflict: "user_id,variant_id" });
  if (error) throw error;
}

export async function removeServerItem(variant_id) {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("user_id", user_id)
    .eq("variant_id", variant_id);
  if (error) throw error;
}

export async function clearServerCart() {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase.from("cart_items").delete().eq("user_id", user_id);
  if (error) throw error;
}

// Live stock (per variant) + price (per product) for the given cart items.
export async function fetchLiveVariantData(items) {
  if (!items.length) return {};
  const variantIds = items.map((i) => i.variant_id);
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const [{ data: variants }, { data: products }] = await Promise.all([
    supabase.from("productsizecolors").select("variantid, stock").in("variantid", variantIds),
    supabase.from("products").select("productid, retailprice").in("productid", productIds),
  ]);
  const priceByProduct = {};
  (products || []).forEach((p) => (priceByProduct[p.productid] = Number(p.retailprice)));
  const out = {};
  (variants || []).forEach((v) => {
    const item = items.find((i) => i.variant_id === v.variantid);
    out[v.variantid] = { stock: Number(v.stock), price: item ? priceByProduct[item.product_id] : undefined };
  });
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/cartApi.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storefront/lib/cartApi.js src/storefront/__tests__/cartApi.test.js
git commit -m "feat(cart): server cart data layer over cart_items"
```

---

### Task 4: `StorefrontAuthContext` + mount in layout

**Files:**
- Create: `src/storefront/context/StorefrontAuthContext.jsx`
- Modify: `src/storefront/components/StorefrontLayout.jsx`
- Test: `src/storefront/__tests__/StorefrontAuthContext.test.jsx`

**Interfaces:**
- Produces:
  - `StorefrontAuthProvider` (component).
  - `useStorefrontAuth()` → `{ user, session, loading, signInWithOtp(email), signOut() }`.
  - `signInWithOtp(email)` calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/account } })`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("lib/supabaseClient", () => {
  const listeners = [];
  const auth = {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    onAuthStateChange: jest.fn((cb) => {
      listeners.push(cb);
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    }),
    signInWithOtp: jest.fn(async () => ({ error: null })),
    signOut: jest.fn(async () => ({ error: null })),
  };
  return { supabase: { auth } };
});

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { supabase } from "lib/supabaseClient";
import { StorefrontAuthProvider, useStorefrontAuth } from "../context/StorefrontAuthContext";

function Probe() {
  const { signInWithOtp } = useStorefrontAuth();
  return <button onClick={() => signInWithOtp("a@b.com")}>go</button>;
}

it("requests a magic link redirecting to /account", async () => {
  render(
    <StorefrontAuthProvider>
      <Probe />
    </StorefrontAuthProvider>
  );
  await act(async () => {
    screen.getByText("go").click();
  });
  expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
    email: "a@b.com",
    options: { emailRedirectTo: expect.stringContaining("/account") },
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/StorefrontAuthContext.test.jsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the context**

Create `src/storefront/context/StorefrontAuthContext.jsx`:

```js
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "lib/supabaseClient";

const StorefrontAuthContext = createContext(null);

export function StorefrontAuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signInWithOtp = useCallback(
    (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/account` },
      }),
    []
  );
  const signOut = useCallback(() => supabase.auth.signOut(), []);

  return (
    <StorefrontAuthContext.Provider
      value={{ user: session?.user ?? null, session, loading, signInWithOtp, signOut }}
    >
      {children}
    </StorefrontAuthContext.Provider>
  );
}

export function useStorefrontAuth() {
  const ctx = useContext(StorefrontAuthContext);
  if (!ctx) throw new Error("useStorefrontAuth must be used inside StorefrontAuthProvider");
  return ctx;
}
```

- [ ] **Step 4: Mount the provider in the layout**

Modify `src/storefront/components/StorefrontLayout.jsx` — wrap the existing tree so auth sits above the cart:

```jsx
import React from "react";
import { Outlet } from "react-router-dom";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontFooter from "./StorefrontFooter";
import { CartProvider } from "../context/CartContext";
import { StorefrontAuthProvider } from "../context/StorefrontAuthContext";
import CartDrawer from "./cart/CartDrawer";

export default function StorefrontLayout() {
  return (
    <StorefrontAuthProvider>
      <CartProvider>
        <div className="min-h-dvh bg-storefront-cream font-sans text-storefront-charcoal">
          <StorefrontHeader />
          <main>
            <Outlet />
          </main>
          <StorefrontFooter />
          <CartDrawer />
        </div>
      </CartProvider>
    </StorefrontAuthProvider>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/StorefrontAuthContext.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/context/StorefrontAuthContext.jsx src/storefront/components/StorefrontLayout.jsx src/storefront/__tests__/StorefrontAuthContext.test.jsx
git commit -m "feat(auth): storefront auth context (email magic link)"
```

---

### Task 5: Auth-aware `CartContext`

**Files:**
- Modify: `src/storefront/context/CartContext.jsx`
- Test: `src/storefront/__tests__/CartContext.test.jsx`

**Interfaces:**
- Consumes: `mergeCarts`, `revalidateItems` (Task 2); `fetchServerCart`, `upsertItem`, `removeServerItem`, `fetchLiveVariantData` (Task 3); `supabase.auth.onAuthStateChange`.
- Produces: same `useCart()` value as today plus `revalidateCart(): Promise<changes[]>` and `syncing: boolean`. Existing methods (`addItem`, `removeItem`, `updateQty`, `clearCart`, `openCart`, `closeCart`, `itemCount`, `items`, `isOpen`) keep their signatures.

- [ ] **Step 1: Write the failing test** (write-through on authed add)

```js
const mockUpsert = jest.fn(async () => {});
jest.mock("../lib/cartApi", () => ({
  fetchServerCart: jest.fn(async () => []),
  upsertItem: (...a) => mockUpsert(...a),
  removeServerItem: jest.fn(async () => {}),
  clearServerCart: jest.fn(async () => {}),
  fetchLiveVariantData: jest.fn(async () => ({})),
}));
let authCb;
jest.mock("lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { CartProvider, useCart } from "../context/CartContext";

function Probe() {
  const { addItem, itemCount } = useCart();
  return (
    <>
      <span data-testid="count">{itemCount}</span>
      <button onClick={() => addItem({ variant_id: "v1", product_id: "BC1", quantity: 1, name: "X", size: "F", color: "R", price: 10, image_url: null })}>add</button>
    </>
  );
}

beforeEach(() => { mockUpsert.mockClear(); localStorage.clear(); });

it("writes through to the server when a user is signed in", async () => {
  render(<CartProvider><Probe /></CartProvider>);
  await act(async () => { authCb("SIGNED_IN", { user: { id: "u1" } }); });
  await act(async () => { screen.getByText("add").click(); });
  expect(screen.getByTestId("count").textContent).toBe("1");
  expect(mockUpsert).toHaveBeenCalledWith({ variant_id: "v1", product_id: "BC1", quantity: 1 });
});

it("does not write through as a guest", async () => {
  render(<CartProvider><Probe /></CartProvider>);
  await act(async () => { screen.getByText("add").click(); });
  expect(mockUpsert).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/CartContext.test.jsx`
Expected: FAIL (new behaviour/exports absent).

- [ ] **Step 3: Implement the rework**

Replace `src/storefront/context/CartContext.jsx` with:

```js
import React, {
  createContext, useContext, useState, useEffect, useCallback, useRef,
} from "react";
import { supabase } from "lib/supabaseClient";
import { mergeCarts, revalidateItems } from "../lib/cartLogic";
import {
  fetchServerCart, upsertItem, removeServerItem, clearServerCart, fetchLiveVariantData,
} from "../lib/cartApi";

const STORAGE_KEY = "bc_cart";

export const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [isOpen, setIsOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const userIdRef = useRef(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  // Auth-driven sync. Subscribe directly to supabase.auth for event granularity
  // (merge only on a genuine SIGNED_IN, load-only on session restore).
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      const uid = session?.user?.id ?? null;
      userIdRef.current = uid;

      if (event === "SIGNED_OUT" || !uid) {
        userIdRef.current = null;
        setItems([]);
        return;
      }
      setSyncing(true);
      try {
        const server = await fetchServerCart();
        if (event === "SIGNED_IN") {
          // Genuine login: union guest + server (max), then persist the merge.
          const merged = mergeCarts(itemsRef.current, server);
          setItems(merged);
          await Promise.all(
            merged.map((i) =>
              upsertItem({ variant_id: i.variant_id, product_id: i.product_id, quantity: i.quantity })
            )
          ).catch(() => {});
        } else {
          // INITIAL_SESSION / TOKEN_REFRESHED: server is the source of truth.
          setItems(server);
        }
      } finally {
        setSyncing(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const persist = useCallback((variant_id, next) => {
    if (!userIdRef.current) return;
    if (next) {
      upsertItem({ variant_id, product_id: next.product_id, quantity: next.quantity }).catch(() => {});
    } else {
      removeServerItem(variant_id).catch(() => {});
    }
  }, []);

  const addItem = useCallback(
    (payload) => {
      const { variant_id, product_id, quantity } = payload;
      if (!quantity || quantity <= 0) return;
      setItems((prev) => {
        const existing = prev.find((i) => i.variant_id === variant_id);
        const next = existing
          ? prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity: i.quantity + quantity } : i))
          : [...prev, { ...payload }];
        const row = next.find((i) => i.variant_id === variant_id);
        persist(variant_id, { product_id, quantity: row.quantity });
        return next;
      });
    },
    [persist]
  );

  const removeItem = useCallback(
    (variant_id) => {
      setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
      persist(variant_id, null);
    },
    [persist]
  );

  const updateQty = useCallback(
    (variant_id, quantity) => {
      if (quantity <= 0) {
        setItems((prev) => prev.filter((i) => i.variant_id !== variant_id));
        persist(variant_id, null);
        return;
      }
      setItems((prev) => {
        const next = prev.map((i) => (i.variant_id === variant_id ? { ...i, quantity } : i));
        const row = next.find((i) => i.variant_id === variant_id);
        if (row) persist(variant_id, { product_id: row.product_id, quantity });
        return next;
      });
    },
    [persist]
  );

  const clearCart = useCallback(() => {
    setItems([]);
    if (userIdRef.current) clearServerCart().catch(() => {});
  }, []);

  // Reconcile the current cart against live stock/price. Returns the changes so
  // the caller can surface toasts. Persists caps/removals when signed in.
  const revalidateCart = useCallback(async () => {
    const current = itemsRef.current;
    if (!current.length) return [];
    const live = await fetchLiveVariantData(current);
    const { items: next, changes } = revalidateItems(current, live);
    if (changes.length) {
      setItems(next);
      if (userIdRef.current) {
        changes.forEach((c) => {
          if (c.type === "removed") removeServerItem(c.variant_id).catch(() => {});
        });
        next.forEach((i) =>
          upsertItem({ variant_id: i.variant_id, product_id: i.product_id, quantity: i.quantity }).catch(() => {})
        );
      }
    }
    return changes;
  }, []);

  const openCart = useCallback(() => setIsOpen(true), []);
  const closeCart = useCallback(() => setIsOpen(false), []);
  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items, itemCount, isOpen, syncing,
        openCart, closeCart, addItem, removeItem, updateQty, clearCart, revalidateCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/CartContext.test.jsx`
Expected: PASS (both tests).

- [ ] **Step 5: Run existing cart-dependent tests (regression)**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/CartDrawer.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/context/CartContext.jsx src/storefront/__tests__/CartContext.test.jsx
git commit -m "feat(cart): auth-aware CartContext with server sync"
```

---

### Task 6: `LoginPage` + route

**Files:**
- Create: `src/storefront/pages/LoginPage.jsx`
- Modify: `src/App.js` (add `login` route)
- Test: `src/storefront/__tests__/LoginPage.test.jsx`

**Interfaces:**
- Consumes: `useStorefrontAuth().signInWithOtp` (Task 4).

- [ ] **Step 1: Write the failing test**

```js
const mockSignIn = jest.fn(async () => ({ error: null }));
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ signInWithOtp: mockSignIn, user: null }),
}));

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LoginPage from "../pages/LoginPage";

it("emails a magic link and shows the sent state", async () => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.com" } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /sign-in link/i }).closest("form")); });
  expect(mockSignIn).toHaveBeenCalledWith("a@b.com");
  expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/LoginPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

Create `src/storefront/pages/LoginPage.jsx`:

```jsx
import React, { useState } from "react";
import Seo from "../components/Seo";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";

export default function LoginPage() {
  const { signInWithOtp } = useStorefrontAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = (await signInWithOtp(email)) || {};
    setBusy(false);
    if (error) setError(error.message || "Could not send the link. Try again.");
    else setSent(true);
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <Seo title="Sign in" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">Sign in</h1>
      <p className="text-sm text-storefront-muted font-sans mb-8">
        We’ll email you a secure link — no password needed.
      </p>

      {sent ? (
        <p className="text-sm font-sans text-storefront-charcoal">
          Check your inbox — we sent a sign-in link to <strong>{email}</strong>.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block text-xs font-sans tracking-wide text-storefront-charcoal" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
          />
          {error && <p className="text-xs text-red-600 font-sans">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors disabled:opacity-40"
          >
            {busy ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the route**

Modify `src/App.js` — add the import and the route inside the storefront `<Route path="/" element={<StorefrontLayout />}>` block, after the `size-guide` route:

```jsx
import LoginPage from "./storefront/pages/LoginPage";
```
```jsx
<Route path="login" element={<LoginPage />} />
```

- [ ] **Step 5: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/LoginPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/pages/LoginPage.jsx src/App.js src/storefront/__tests__/LoginPage.test.jsx
git commit -m "feat(auth): magic-link login page"
```

---

### Task 7: `AccountPage` + `AccountOrdersPage` stub + routes

**Files:**
- Create: `src/storefront/pages/AccountPage.jsx`, `src/storefront/pages/AccountOrdersPage.jsx`
- Modify: `src/App.js`
- Test: `src/storefront/__tests__/AccountPage.test.jsx`

**Interfaces:**
- Consumes: `useStorefrontAuth()` (Task 4); `supabase.rpc('resolve_my_customer')`, `supabase.rpc('update_my_customer', {...})` (Task 1).

- [ ] **Step 1: Write the failing test**

```js
const mockSignOut = jest.fn(async () => ({ error: null }));
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ user: { id: "u1", email: "a@b.com" }, signOut: mockSignOut, loading: false }),
}));
jest.mock("lib/supabaseClient", () => ({
  supabase: {
    rpc: jest.fn(async () => ({
      data: [{ customerid: 1, first_name: "Asha", last_name: "K", phone: "", email: "a@b.com", address: "", gender: "", needs_review: false }],
      error: null,
    })),
  },
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import AccountPage from "../pages/AccountPage";

it("resolves and shows the customer on mount", async () => {
  render(<MemoryRouter><AccountPage /></MemoryRouter>);
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("resolve_my_customer"));
  expect(await screen.findByDisplayValue("Asha")).toBeInTheDocument();
  expect(screen.getByText("a@b.com")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/AccountPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement `AccountPage`**

Create `src/storefront/pages/AccountPage.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { toast } from "sonner";
import Seo from "../components/Seo";
import { supabase } from "lib/supabaseClient";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";

const EMPTY = { first_name: "", last_name: "", phone: "", address: "", gender: "" };

export default function AccountPage() {
  const { user, loading, signOut } = useStorefrontAuth();
  const [form, setForm] = useState(EMPTY);
  const [loadingCustomer, setLoadingCustomer] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.rpc("resolve_my_customer").then(({ data }) => {
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setForm({
        first_name: row.first_name ?? "", last_name: row.last_name ?? "",
        phone: row.phone ?? "", address: row.address ?? "", gender: row.gender ?? "",
      });
      setLoadingCustomer(false);
    });
    return () => { active = false; };
  }, [user]);

  if (!loading && !user) return <Navigate to="/login" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSave(e) {
    e.preventDefault();
    setSaving(true);
    const { data, error } = await supabase.rpc("update_my_customer", {
      p_first_name: form.first_name, p_last_name: form.last_name,
      p_phone: form.phone, p_address: form.address, p_gender: form.gender,
    });
    setSaving(false);
    if (error) { toast.error("Couldn’t save your details."); return; }
    const row = Array.isArray(data) ? data[0] : data;
    toast.success(row?.needs_review ? "Saved — our team will confirm your details." : "Details saved.");
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-12">
      <Seo title="My account" noindex />
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display text-3xl font-semibold text-storefront-charcoal">My account</h1>
        <button onClick={signOut} className="text-xs font-sans tracking-widest uppercase text-storefront-muted hover:text-storefront-charcoal">
          Sign out
        </button>
      </div>
      <p className="text-sm font-sans text-storefront-muted mb-8">{user?.email}</p>

      <form onSubmit={onSave} className="space-y-4">
        {[
          ["first_name", "First name"], ["last_name", "Last name"],
          ["phone", "Phone"], ["address", "Address"],
        ].map(([k, label]) => (
          <div key={k}>
            <label className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-1">{label}</label>
            <input
              value={form[k]}
              onChange={set(k)}
              disabled={loadingCustomer}
              className="w-full border border-storefront-border bg-white px-3 py-2.5 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>
        ))}
        <button type="submit" disabled={saving || loadingCustomer}
          className="bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-3 px-6 hover:bg-storefront-warm transition-colors disabled:opacity-40">
          {saving ? "Saving…" : "Save details"}
        </button>
      </form>

      <Link to="/account/orders" className="inline-block mt-8 text-xs font-sans tracking-wide text-storefront-muted hover:text-storefront-gold underline underline-offset-2">
        Order history
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Implement the orders stub**

Create `src/storefront/pages/AccountOrdersPage.jsx`:

```jsx
import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";

export default function AccountOrdersPage() {
  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 text-center">
      <Seo title="Order history" noindex />
      <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">Order history</h1>
      <p className="text-sm font-sans text-storefront-muted mb-6">
        Online order history is coming soon. For past in-store purchases, contact us and we’ll help.
      </p>
      <Link to="/account" className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
        ← Back to account
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Add routes**

Modify `src/App.js` — add imports and routes in the storefront block:

```jsx
import AccountPage from "./storefront/pages/AccountPage";
import AccountOrdersPage from "./storefront/pages/AccountOrdersPage";
```
```jsx
<Route path="account" element={<AccountPage />} />
<Route path="account/orders" element={<AccountOrdersPage />} />
```

- [ ] **Step 6: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/AccountPage.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storefront/pages/AccountPage.jsx src/storefront/pages/AccountOrdersPage.jsx src/App.js src/storefront/__tests__/AccountPage.test.jsx
git commit -m "feat(auth): account page + order-history stub"
```

---

### Task 8: Header account entry point

**Files:**
- Modify: `src/storefront/components/StorefrontHeader.jsx`
- Test: `src/storefront/__tests__/StorefrontHeader.test.jsx` (extend existing)

**Interfaces:**
- Consumes: `useStorefrontAuth()` (Task 4).

- [ ] **Step 1: Write the failing test** (append to the existing describe block)

```js
jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ user: null }),
}));

it("shows an account link for signed-out visitors", () => {
  renderHeader();
  expect(screen.getByRole("link", { name: /account|sign in/i })).toHaveAttribute("href", "/login");
});
```

> The existing `StorefrontHeader.test.jsx` renders inside `CartProvider`; add the auth mock above at the top of the file. Because `renderHeader` does not wrap `StorefrontAuthProvider`, the mock supplies the hook.

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/StorefrontHeader.test.jsx`
Expected: FAIL (no account link yet).

- [ ] **Step 3: Implement**

In `src/storefront/components/StorefrontHeader.jsx`:
- Add to the lucide import: `User`.
- Add `import { useStorefrontAuth } from "../context/StorefrontAuthContext";`
- Inside the component: `const { user } = useStorefrontAuth();`
- In the actions row, before the cart button, add:

```jsx
<Link
  to={user ? "/account" : "/login"}
  aria-label={user ? "Account" : "Sign in"}
  className="p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors"
>
  <User size={20} />
</Link>
```

(`Link` is already imported in this file.)

- [ ] **Step 4: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/StorefrontHeader.test.jsx`
Expected: PASS (existing tests + new one).

- [ ] **Step 5: Commit**

```bash
git add src/storefront/components/StorefrontHeader.jsx src/storefront/__tests__/StorefrontHeader.test.jsx
git commit -m "feat(auth): header account entry point"
```

---

### Task 9: `/cart` page + drawer revalidation

**Files:**
- Create: `src/storefront/pages/CartPage.jsx`
- Modify: `src/App.js` (route); `src/storefront/components/cart/CartDrawer.jsx` (revalidate on open + "View cart" link)
- Test: `src/storefront/__tests__/CartPage.test.jsx`

**Interfaces:**
- Consumes: `useCart()` — `items`, `updateQty`, `removeItem`, `revalidateCart` (Task 5).

- [ ] **Step 1: Write the failing test**

```js
const mockRevalidate = jest.fn(async () => []);
jest.mock("../context/CartContext", () => ({
  useCart: () => ({
    items: [
      { variant_id: "v1", product_id: "BC1", quantity: 2, name: "Silk Saree", size: "FREE", color: "Red", price: 1500, image_url: null },
    ],
    updateQty: jest.fn(),
    removeItem: jest.fn(),
    revalidateCart: mockRevalidate,
  }),
}));

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CartPage from "../pages/CartPage";

it("lists items, shows subtotal, and revalidates on mount", async () => {
  render(<MemoryRouter><CartPage /></MemoryRouter>);
  expect(screen.getByText("Silk Saree")).toBeInTheDocument();
  expect(screen.getByText(/₹3,000/)).toBeInTheDocument(); // 2 × 1500 subtotal
  await waitFor(() => expect(mockRevalidate).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: /order on whatsapp/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/CartPage.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implement the page**

Create `src/storefront/pages/CartPage.jsx`:

```jsx
import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import Seo from "../components/Seo";
import { useCart } from "../context/CartContext";

const WHATSAPP = "919810873280";

function subtotalOf(items) {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

function whatsappHref(items, subtotal) {
  const lines = items
    .map((i) => `• ${i.name} (${i.size}/${i.color}) ×${i.quantity} — ₹${(i.price * i.quantity).toLocaleString("en-IN")}`)
    .join("%0A");
  const text = `Hi, I’d like to order:%0A${lines}%0A%0ASubtotal: ₹${subtotal.toLocaleString("en-IN")}`;
  return `https://wa.me/${WHATSAPP}?text=${text}`;
}

export default function CartPage() {
  const { items, updateQty, removeItem, revalidateCart } = useCart();

  useEffect(() => {
    revalidateCart().then((changes) => {
      changes?.forEach((c) => {
        if (c.type === "removed") toast.warning(`${c.name} is no longer available and was removed.`);
        if (c.type === "capped") toast.warning(`${c.name}: quantity reduced to available stock.`);
        if (c.type === "repriced") toast.info(`${c.name}: price updated.`);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = subtotalOf(items);

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Seo title="Your cart" noindex />
        <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">Your cart is empty</h1>
        <Link to="/shop" className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Seo title="Your cart" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-8">Your cart</h1>

      <ul className="divide-y divide-storefront-border">
        {items.map((i) => (
          <li key={i.variant_id} className="flex gap-4 py-5">
            <div className="w-20 h-24 flex-shrink-0 bg-storefront-cream overflow-hidden">
              {i.image_url && <img src={i.image_url} alt={i.name} loading="lazy" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm text-storefront-charcoal">{i.name}</p>
              <p className="text-xs text-storefront-muted font-sans">{i.size} · {i.color}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center border border-storefront-border">
                  <button aria-label="Decrease" onClick={() => updateQty(i.variant_id, i.quantity - 1)} className="w-8 h-8">−</button>
                  <span className="w-8 text-center text-sm tabular-nums">{i.quantity}</span>
                  <button aria-label="Increase" onClick={() => updateQty(i.variant_id, i.quantity + 1)} className="w-8 h-8">+</button>
                </div>
                <button onClick={() => removeItem(i.variant_id)} className="text-xs font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2">
                  Remove
                </button>
              </div>
            </div>
            <p className="font-sans text-sm tabular-nums text-storefront-charcoal">
              ₹{(i.price * i.quantity).toLocaleString("en-IN")}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8 border-t border-storefront-border pt-6 flex flex-col items-end gap-4">
        <p className="font-sans text-sm text-storefront-charcoal">
          Subtotal <span className="font-semibold tabular-nums">₹{subtotal.toLocaleString("en-IN")}</span>
        </p>
        <p className="text-xs text-storefront-muted font-sans">Shipping calculated at checkout.</p>
        <button disabled className="w-full sm:w-auto bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 px-8 opacity-40 cursor-not-allowed">
          Online checkout launching soon
        </button>
        <a
          href={whatsappHref(items, subtotal)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto text-center bg-[#25D366] text-white font-sans text-xs tracking-widest uppercase py-4 px-8 hover:opacity-90 transition-opacity"
        >
          Order on WhatsApp
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route + drawer**

Modify `src/App.js`:
```jsx
import CartPage from "./storefront/pages/CartPage";
```
```jsx
<Route path="cart" element={<CartPage />} />
```

Modify `src/storefront/components/cart/CartDrawer.jsx`:
- Pull `revalidateCart` and `isOpen` from `useCart()` (already uses the context).
- Add an effect: `useEffect(() => { if (isOpen) revalidateCart(); }, [isOpen, revalidateCart]);`
- Ensure the drawer's primary CTA links to `/cart` (a `<Link to="/cart" onClick={closeCart}>View cart</Link>` styled as the existing button). If a checkout button already exists in the drawer, repoint it to `/cart`.

- [ ] **Step 5: Run to verify pass**

Run: `CI=true npx react-scripts test --watchAll=false src/storefront/__tests__/CartPage.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the whole storefront suite (regression)**

Run: `CI=true npx react-scripts test --watchAll=false --testPathPattern="src/storefront"`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/storefront/pages/CartPage.jsx src/App.js src/storefront/components/cart/CartDrawer.jsx src/storefront/__tests__/CartPage.test.jsx
git commit -m "feat(cart): full /cart page + drawer revalidation"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run: `CI=true npm run build`
Expected: `Compiled successfully.`

- [ ] **Step 2: Drive the flow in the browser** (dev server on :3000)

Verify, via Playwright CLI (`npx playwright`, per project rules — not MCP):
- `/login` renders; submitting an email shows the "check your inbox" state.
- `/cart` with a seeded localStorage cart lists items, shows subtotal, and renders both the disabled checkout button and the WhatsApp order link.
- Header shows the account icon linking to `/login` when signed out.
- Signed out, navigating to `/admin/inventory` redirects to `/unauthorized` (confirms customer/admin separation).

Capture a screenshot of `/cart` to the scratchpad and confirm layout.

- [ ] **Step 3: Refresh the knowledge graph**

Run: `/opt/homebrew/opt/python@3.10/bin/python3.10 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`

- [ ] **Step 4: Final commit (if graph or docs changed)**

```bash
git add -A
git commit -m "chore: verification + graph refresh for cart/customer-auth"
```

---

## Notes for the implementer

- **Identity behaviour tests (Task 1)** are structural only in SQL; the verified-JWT paths (email link, guarded phone) are hard to unit-test without a real auth token. Exercise them manually against the linked DB with a test email during Task 10, or accept the RPC logic is covered by review + the structural assertions. Do not weaken the guard conditions to make testing easier.
- **Magic-link email** uses Supabase's built-in SMTP, which is rate-limited and not production-grade. Flag to the owner: configure custom SMTP in Supabase Auth settings before real traffic.
- The `resolve_my_customer` placeholder row (created when no email/phone match exists) is intentionally kept; a later admin-side cleanup can prune placeholder rows that have no cart and no orders. It is harmless and correctly unlinked after any phone reclaim.
