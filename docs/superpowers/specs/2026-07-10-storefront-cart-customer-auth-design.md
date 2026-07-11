# Design: Storefront Cart Page + Customer Login

**Date:** 2026-07-10
**Branch:** `feat/storefront-cart-customer-auth`
**Status:** Approved design → ready for implementation plan

## Goal

Ship two independent-but-related storefront capabilities, ahead of the deferred payment/checkout work:

1. A full **`/cart` page** with line-item editing and live stock/price revalidation (plan F4).
2. **Customer login** via email magic link, so a customer's cart persists server-side and is retrievable on any device — and so their online identity reconciles with the in-store `customers` record by email/phone.

Guest checkout stays first-class: the localStorage cart keeps working unauthenticated. Login only *adds* persistence and identity.

## Out of scope (YAGNI)

- Real checkout / payment / order creation (deferred Phase 2).
- Password auth, social/OAuth login, phone-OTP login.
- Order-history **data** (the `orders` table does not exist yet) — only a static stub page.
- Saved addresses, wishlist, loyalty UI.
- Admin-side customer merge tooling for flagged phone collisions (noted as a follow-up).

## Key facts from codebase research (2026-07-10)

- **`cart_items` already exists and is production-ready.** Columns: `id uuid PK`, `user_id uuid NOT NULL → auth.users(id) ON DELETE CASCADE`, `variant_id uuid → productsizecolors(variantid)`, `product_id text → products(productid)`, `quantity int4 CHECK(quantity>0)`, `added_at`, `updated_at`. `UNIQUE(user_id, variant_id)`. RLS enabled, policy `auth.uid() = user_id` for ALL ops. **No cart migration required.** It stores no price/name snapshot, so the cart JOINs to live product data on load — which *is* the revalidation.
- **`customers`** (`customerid int4 PK`, `customer_ulid varchar NOT NULL`, `first_name varchar NOT NULL`, `last_name`, `phone`, `email`, `address`, `gender`, `store_credit float8`, `is_guest bool`, `customer_notes`, …). RLS = single policy `admin_only` (`is_admin()`) for ALL. Holds money (`store_credit`) + PII. No column linking to `auth.users` today. Store app generates `customer_ulid` as `uuidv4().replace(/-/g,'').slice(0,26)` and dedups by phone at entry (`CustomerForm.js`).
- **`profiles`** (`id uuid = auth.users.id`, `email`, `role text DEFAULT 'user'`, `is_active bool DEFAULT false`). RLS: `profiles_read_own` (select where `auth.uid()=id`), `profiles_admin_all` (`is_admin()`).
- Trigger `on_auth_user_created → handle_new_user()` fires on every signup and inserts `profiles(id, email)` only → new customers get `role='user'`, `is_active=false`. `is_admin()` requires role in (`admin`,`superadmin`). **RequireAdminAuth denies role `user`/missing row → open magic-link signup cannot reach admin. No privilege escalation.**

## Architecture

### 1. Database migration — `schema/migration_storefront_customer_auth.sql`

Cart needs no schema change. This migration is only for customer-identity reconciliation.

```sql
alter table customers
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
```

Two `SECURITY DEFINER` RPCs are the *only* customer-facing gateway to the `customers` table (table RLS stays `admin_only`). Both derive identity from the verified session (`auth.uid()`, `auth.email()`), never from client-supplied identity, and are `GRANT EXECUTE`d to `authenticated` only.

**`resolve_my_customer()` → returns the caller's customer row.**
Resolution order (verified email is the trust anchor):
1. Row already linked to `auth.uid()` → return it.
2. Else exactly one `customers` row with `email = auth.email()` → set `auth_user_id = auth.uid()`, return it.
3. Else **guarded phone match** — only when the caller has supplied a phone via `update_my_customer` in the same flow (see below); handled inside `update_my_customer`, not here.
4. Else create a new row: `first_name` = email local-part placeholder, `customer_ulid` generated server-side (`replace(gen_random_uuid()::text,'-','')` truncated to 26), `is_guest = false`, `email = auth.email()`, `auth_user_id = auth.uid()`; return it.
Ambiguous email (multiple matches) → do **not** auto-link; return the freshly created/own row and set a `needs_review` flag in the result **and append a dated note to `customer_notes`** so an admin can find and reconcile it (no new column needed).

**`update_my_customer(p_first_name, p_last_name, p_phone, p_address, p_gender)` → updates the caller's row.**
- Updates only the row where `auth_user_id = auth.uid()` (creating it first via the same logic as `resolve_my_customer` if absent).
- **Guarded phone match:** if the row is a freshly created one (no in-store history) and `p_phone` matches exactly one *other* `customers` row that is (a) not linked (`auth_user_id is null`), (b) has no `email`, and (c) `store_credit = 0`, then re-link the caller to that record (merge the typed profile fields into it) — this safely reclaims phone-only in-store records. If the matched record has `store_credit > 0` or an `email`, do **not** link; write the phone onto the caller's own row, append a dated `customer_notes` note on the caller's row for admin follow-up, and return a `needs_review` flag. Never expose the other record's data to the caller.

### 2. Customer auth — `StorefrontAuthContext`

- Wraps `supabase.auth`: exposes `{ user, session, loading, signInWithOtp(email), signOut() }`.
- Subscribes to `onAuthStateChange`; provider mounts in `StorefrontLayout` above `CartProvider` so the cart can react to login/logout.
- Magic link: `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <origin>/account } })`. Supabase's `detectSessionInUrl` consumes the callback hash automatically; no custom callback route needed.

**Routes** (public storefront):
- `/login` — email field → "Email me a sign-in link" → success state ("check your inbox").
- `/account` — requires session (else redirect `/login`): shows resolved customer (name, email, phone), an edit form calling `update_my_customer`, logout. Calls `resolve_my_customer()` on mount.
- `/account/orders` — static stub: "Online order history is coming soon." No DB query (orders table absent).

**Header:** add an account icon — logged-out → link to `/login`; logged-in → menu (Account, Orders, Sign out).

### 3. Cart persistence — auth-aware `CartContext` + `cartApi.js`

`cartApi.js` (thin data layer over `cart_items`):
- `fetchServerCart()` → select `cart_items` JOIN `productsizecolors` (size,color,stock) JOIN `products` (name, retailprice), map to the CartContext item shape; resolve image via existing `productImage` helper.
- `upsertItem(variant_id, product_id, quantity)` → upsert on `(user_id, variant_id)` (`user_id` from session).
- `removeItem(variant_id)`, `clearServerCart()`.

`CartContext` becomes auth-aware:
- **Guest** (no session): localStorage only, exactly as today.
- **On login** (`onAuthStateChange` → SIGNED_IN): `mergeCarts(localItems, serverItems)` → union by `variant_id`, sum quantities, cap each at live stock; write merged deltas to server; `setItems(merged)`; mirror to localStorage.
- **Authed mutation** (add/remove/updateQty): optimistic local update + async `cartApi` call; on failure keep local state and toast "Couldn't sync your cart"; localStorage mirror means nothing is lost.
- **On logout** (SIGNED_OUT): clear items + localStorage.
- `mergeCarts` and the revalidation flagger are **pure functions** in `lib/cartLogic.js`, unit-tested.

### 4. `/cart` page

- Route `/cart`. Line items: image, name, size/color, price, qty stepper (bounded by live stock), remove.
- **Revalidation on load** (and on drawer open — F4): per variant fetch live `stock` + `retailprice`; cap qty over stock (flag "Only N left"), flag repriced items ("Price updated to ₹X"), drop vanished variants (flag "No longer available"). Uses the pure flagger.
- Order summary: subtotal; shipping/total shown as "calculated at checkout".
- **Interim terminal CTA** (real `/checkout` deferred): a disabled "Online checkout launching soon" primary button **plus** a "Order on WhatsApp" button (`wa.me` prefilled with a text summary of cart lines + subtotal) so customers can transact now, backend-free.

## Data flow

```
Guest:   UI → CartContext → localStorage
Login:   email → signInWithOtp → emailed link → session set
           → onAuthStateChange(SIGNED_IN)
           → resolve_my_customer()  (identity)
           → mergeCarts(local, server) → write deltas → setItems → mirror localStorage
Authed:  UI → CartContext (optimistic) → cartApi upsert/remove ; toast on failure
Logout:  signOut → clear items + localStorage
```

## Failure modes

- Server write fails while authed → optimistic local kept + toast; localStorage mirror prevents loss; reconciles on next load/mutation.
- Two devices → last-write-wins per `(user_id, variant_id)` upsert. Acceptable for a cart.
- Ambiguous email or guarded-phone rejection → `needs_review` flag surfaced to admin later; customer proceeds on a clean own-row, never blocked, never shown another's data.
- Magic-link email uses Supabase default SMTP (rate-limited) → **production needs custom SMTP** (owner action, documented).

## Security

- `cart_items` RLS already restricts every op to `auth.uid() = user_id`; storefront stays on the anon key, auth issues a user JWT so RLS applies. No anon cart access.
- `customers` RLS stays `admin_only`; customer access flows solely through the two `SECURITY DEFINER` RPCs, which trust only the verified session identity. Unverified phone can never claim a record holding `store_credit` or an email.
- No new admin surface: magic-link users are `role='user'`, denied by RequireAdminAuth.
- **Customers never see admin access.** Storefront and admin are separate layouts with no shared navigation; the new storefront account menu links only to `/account`, `/account/orders`, and sign-out — never to any `/admin/*` route. A `role='user'` session hitting `/admin/*` directly is redirected to `/unauthorized` by the existing RequireAdminAuth. No admin links, buttons, or pages are rendered for customer sessions.
- No secrets client-side.

## Testing

- **Unit (pure):** `mergeCarts` (union, sum, stock cap), revalidation flagger (over-stock / repriced / removed).
- **RPC / integration:** `resolve_my_customer` (link-by-email, create-new, ambiguous), `update_my_customer` guarded-phone (safe reclaim vs blocked when store_credit>0 / email present) — via SQL against the linked DB or a seeded fixture.
- **Component:** `/login` submit calls `signInWithOtp`; `/cart` qty edit + remove + revalidation flags render.

## Components / files

- `schema/migration_storefront_customer_auth.sql` (new)
- `src/storefront/context/StorefrontAuthContext.jsx` (new)
- `src/storefront/lib/cartApi.js` (new)
- `src/storefront/lib/cartLogic.js` (new — pure merge/revalidate)
- `src/storefront/pages/LoginPage.jsx`, `AccountPage.jsx`, `AccountOrdersPage.jsx` (new)
- `src/storefront/pages/CartPage.jsx` (new)
- `src/storefront/context/CartContext.jsx` (modified — auth-aware)
- `src/storefront/components/StorefrontHeader.jsx` (modified — account icon)
- `src/storefront/components/StorefrontLayout.jsx` (modified — mount auth provider)
- `src/App.js` (modified — routes `/login`, `/account`, `/account/orders`, `/cart`)
- Tests alongside the above in `src/storefront/__tests__/`.
