# Storefront Phase 0 — Security + Trust Prerequisites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the storefront's cost-price data leak, remove the service-role-key footgun, harden the WhatsApp edge function, and strip fake/dead content — the gate that blocks driving any more public traffic (source: `docs/STOREFRONT-OVERHAUL-PLAN.md` §6 Phase 0).

**Architecture:** Four independent changes. (1) A privileged SQL migration replaces anon's blanket `SELECT` on `products` with column-level grants that exclude `purchaseprice`, and revokes anon access to `mockups_view`; one coupled frontend edit stops `useProduct` from selecting `*`. (2) Rename the mis-prefixed env var so CRA can never inline it. (3) Add JWT+role auth and a CORS allowlist to the `send-bill-sms` Deno edge function. (4) Delete fake Reviews/Newsletter sections and neutralize dead nav/footer links and the "Worldwide" claim.

**Tech Stack:** React 19 (CRA), Supabase (Postgres + RLS + Auth), Deno edge functions, Tailwind. No test framework beyond CRA's Jest; security verification is done with live `curl` probes committed as a re-runnable Node script.

## Global Constraints

- Product ID format: `BC{YY}{###}` (verbatim from CLAUDE.md). Not touched here, listed for context.
- Schema changes go in **new** `schema/migration_*.sql` files — never edit existing `schema/*.sql` table files (source: CLAUDE.md + `feedback_schema_migrations`).
- Privileged migrations (GRANT/REVOKE) are applied **in the Supabase SQL editor**, as the existing `schema/migration_storefront_public_read.sql` header instructs ("Apply once in the Supabase SQL editor"). `service_role` does not own `public.products` (owned by `postgres`), so REVOKE via `scripts/migrate.js` would fail.
- Before writing any DB query, confirm real column names against live schema, never assume (source: `feedback_verify_table_schema`). The column list below was fetched live on 2026-07-09.
- `products` live columns: `productid, name, description, categoryid, fabric, purchaseprice, retailprice, producturl, unit_type`. Only `purchaseprice` is sensitive (cost/margin).
- Storefront talks to Supabase with the **anon** key. Admin panel talks with an **authenticated** (admin) JWT. RLS is row-level, not column-level — column privileges are the only way to hide `purchaseprice` from anon.
- Env for schema fetch / migrate is loaded via `source .env` (see CLAUDE.md schema-fetch snippet).

---

## Task Independence

All four tasks are independent — no shared new interfaces, no ordering dependency. They can be executed and reviewed in any order. Recommended order is 1 → 4 → 2 → 3 (highest security value first, cheapest cleanup second).

---

### Task 1: Close the cost-price leak (products column grants + mockups_view revoke)

**Why:** Live probe on 2026-07-09 confirmed anon can read `products.purchaseprice` **directly** (`/rest/v1/products?select=productid,purchaseprice` returns cost prices) **and** via `mockups_view` (which exposes `purchaseprice`+`fabric` and runs with definer rights, bypassing RLS). The audit named only the view; the direct `products` leak is the larger hole. RLS `using(true)` grants row access to every column, so the fix is column-level `GRANT`, plus revoking anon on the admin-only view.

**Files:**
- Create: `schema/migration_storefront_cost_price_lockdown.sql`
- Create: `scripts/probe-anon-access.js` (re-runnable regression probe)
- Modify: `src/storefront/hooks/useProduct.js:22`
- Modify: `package.json` (add a `probe:anon` script)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `scripts/probe-anon-access.js` — a Node script that exits `0` when anon is correctly blocked from cost data and `1` otherwise. Later Phase 2 checkout work can extend it.

- [ ] **Step 1: Write the failing regression probe**

Create `scripts/probe-anon-access.js`. It reads `.env`, hits the REST API as anon, and asserts cost data is inaccessible.

```js
#!/usr/bin/env node
// Regression probe: anon must NOT be able to read cost/margin data.
// Exits 0 if locked down, 1 if any cost data leaks.
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY");
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let failed = false;

  // 1. Direct products.purchaseprice must be denied (not just empty rows).
  const r1 = await fetch(`${url}/rest/v1/products?select=productid,purchaseprice&limit=1`, { headers });
  const b1 = await r1.text();
  if (r1.ok && b1.includes("purchaseprice")) {
    console.error("LEAK: anon read products.purchaseprice directly ->", b1.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: products.purchaseprice denied to anon");
  }

  // 2. mockups_view must be denied to anon entirely.
  const r2 = await fetch(`${url}/rest/v1/mockups_view?select=productid,purchaseprice&limit=1`, { headers });
  const b2 = await r2.text();
  if (r2.ok && b2.includes("purchaseprice")) {
    console.error("LEAK: anon read mockups_view.purchaseprice ->", b2.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: mockups_view denied to anon");
  }

  // 3. Sanity: anon MUST still read safe catalog columns (storefront depends on it).
  const r3 = await fetch(`${url}/rest/v1/products?select=productid,name,retailprice&limit=1`, { headers });
  const b3 = await r3.text();
  if (!(r3.ok && b3.includes("retailprice"))) {
    console.error("BROKEN: anon can no longer read safe catalog columns ->", r3.status, b3.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: anon still reads safe catalog columns");
  }

  process.exit(failed ? 1 : 0);
}
main();
```

- [ ] **Step 2: Add the npm script and run the probe to verify it FAILS**

Add to `package.json` `"scripts"` (place after `"test"`):

```json
    "probe:anon": "node scripts/probe-anon-access.js",
```

Run: `npm run probe:anon`
Expected: **FAIL / exit 1** with `LEAK: anon read products.purchaseprice directly` and `LEAK: anon read mockups_view.purchaseprice` (this is the current broken state — it proves the probe detects the leak).

- [ ] **Step 3: Write the lockdown migration**

Create `schema/migration_storefront_cost_price_lockdown.sql`:

```sql
-- Storefront cost-price lockdown
--
-- The storefront uses the ANON key. migration_storefront_public_read.sql grants
-- anon row-level SELECT on products via RLS `using (true)`. RLS is row-level, so
-- anon receives EVERY column, including products.purchaseprice (cost/margin).
-- Additionally, mockups_view runs with definer rights and exposes purchaseprice
-- to anon, bypassing RLS entirely.
--
-- Fix: replace anon's blanket table SELECT on products with column-level grants
-- that exclude purchaseprice, and revoke anon SELECT on mockups_view (admin-only).
-- The RLS policy from migration_storefront_public_read.sql stays in place; column
-- privileges are what now hides purchaseprice.
--
-- Apply once in the Supabase SQL editor (run as the postgres role; service_role
-- does not own these objects).

-- ---------------------------------------------------------------------------
-- products: column-level anon SELECT excluding purchaseprice
-- ---------------------------------------------------------------------------
revoke select on public.products from anon;

grant select (
  productid,
  name,
  description,
  categoryid,
  fabric,
  retailprice,
  producturl,
  unit_type
) on public.products to anon;

-- ---------------------------------------------------------------------------
-- mockups_view: admin-only. Only src/admin/components/MockupTable.js queries it,
-- under an authenticated (admin) session. Anon has no legitimate use for it.
-- ---------------------------------------------------------------------------
revoke select on public.mockups_view from anon;
```

- [ ] **Step 4: Apply the migration**

Open the Supabase SQL editor (dashboard → SQL editor), paste the full contents of `schema/migration_storefront_cost_price_lockdown.sql`, and run it. Confirm it reports success with no error.

- [ ] **Step 5: Fix the coupled frontend query (`useProduct.js`)**

`src/storefront/hooks/useProduct.js:22` selects `"*, categories(name)"`. Under column-level grants, `*` expands to include the now-denied `purchaseprice`, so PostgREST returns a permission error and the PDP breaks. Replace `*` with the explicit safe column list.

In `src/storefront/hooks/useProduct.js`, change line 22:

```js
          .select("*, categories(name)")
```

to:

```js
          .select("productid, name, description, categoryid, fabric, retailprice, producturl, unit_type, categories(name)")
```

- [ ] **Step 6: Run the probe to verify it PASSES**

Run: `npm run probe:anon`
Expected: **PASS / exit 0** — three `OK:` lines (products.purchaseprice denied, mockups_view denied, safe columns still readable).

- [ ] **Step 7: Verify the PDP and admin mockups page still work**

Run: `npm start`, then in a browser:
- Open `/product/<any-real-id>` (e.g. `/product/BC25001`) — page loads name, price, gallery, variants (no console error about `purchaseprice` permission).
- Open the admin mockups page (log in as admin, navigate to the Mockups view backed by `MockupTable.js`) — the table still populates (authenticated role retains `mockups_view` access).

- [ ] **Step 8: Commit**

```bash
git add schema/migration_storefront_cost_price_lockdown.sql scripts/probe-anon-access.js package.json src/storefront/hooks/useProduct.js
git commit -m "Storefront: lock down products.purchaseprice + mockups_view from anon"
```

---

### Task 2: Move the service-role key out of the CRA env namespace

**Why:** `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` is defined in `.env`. CRA injects every `REACT_APP_*` var into the build and string-replaces any `process.env.REACT_APP_*` reference it finds in `src/`. This key is currently referenced **only** in `scripts/migrate.js` (a Node build script, not compiled into the bundle) — grep of `src/` returns zero hits — so it is not in the shipped bundle today. The risk is latent: the `REACT_APP_` prefix means one future `src/` reference silently leaks a full-access key into the browser. Renaming removes the footgun. (Corrects the audit's framing that it is currently inlined.)

**Files:**
- Modify: `.env` (rename the key)
- Modify: `scripts/migrate.js:26` and `scripts/migrate.js:29`
- Modify: `CLAUDE.md` (the schema-fetch snippet references the old name)

**Interfaces:**
- Consumes: nothing.
- Produces: env var `SUPABASE_SERVICE_ROLE_KEY` (was `REACT_APP_SUPABASE_SERVICE_ROLE_KEY`), consumed by `scripts/migrate.js` and the CLAUDE.md schema-fetch snippet.

- [ ] **Step 1: Confirm the key is not referenced anywhere in `src/`**

Run: `grep -rn "REACT_APP_SUPABASE_SERVICE_ROLE_KEY" src/`
Expected: **no output** (proves renaming cannot break any compiled code).

- [ ] **Step 2: Rename the var in `.env`**

In `.env`, change the line:

```
REACT_APP_SUPABASE_SERVICE_ROLE_KEY=<the key value>
```

to (keep the same value after the `=`):

```
SUPABASE_SERVICE_ROLE_KEY=<the key value>
```

- [ ] **Step 3: Update the only code consumer (`scripts/migrate.js`)**

In `scripts/migrate.js`, change line 26:

```js
  const key = env.REACT_APP_SUPABASE_SERVICE_ROLE_KEY;
```

to:

```js
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
```

and change line 29:

```js
    console.error("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_SERVICE_ROLE_KEY in .env");
```

to:

```js
    console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
```

- [ ] **Step 4: Update the CLAUDE.md schema-fetch snippet**

In `CLAUDE.md`, the "Database Schema (Live)" snippet uses `$REACT_APP_SUPABASE_SERVICE_ROLE_KEY` twice (in the `apikey:` and `Authorization: Bearer` headers). Replace both occurrences with `$SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 5: Verify migrate.js still reads the key**

Run: `node -e "const m=require('./scripts/migrate.js')" 2>/dev/null; source .env && node -e "const fs=require('fs');const l=fs.readFileSync('.env','utf8');process.exit(l.includes('SUPABASE_SERVICE_ROLE_KEY=') && !l.includes('REACT_APP_SUPABASE_SERVICE_ROLE_KEY=') ? 0 : 1)" && echo "ENV RENAMED OK"`
Expected: prints `ENV RENAMED OK`.

Then confirm the live schema fetch still works with the new name:

Run: `source .env && curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "$REACT_APP_SUPABASE_URL/rest/v1/rpc/get_schema_info" | head -c 100`
Expected: JSON output (not an auth error), proving the renamed var carries a valid service key.

- [ ] **Step 6: Verify a production build does not contain the key value**

Run: `npm run build && grep -rc "$(source .env && echo "$SUPABASE_SERVICE_ROLE_KEY")" build/ 2>/dev/null | grep -v ':0' || echo "KEY ABSENT FROM BUNDLE"`
Expected: prints `KEY ABSENT FROM BUNDLE` (the key value appears in no built asset).

- [ ] **Step 7: Commit**

```bash
git add scripts/migrate.js CLAUDE.md
git commit -m "Move Supabase service-role key out of REACT_APP_ env namespace"
```

Note: `.env` is gitignored and not committed — the rename there is a local/ops action. Flag to the owner that any deploy/CI environment defining `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` must be renamed to `SUPABASE_SERVICE_ROLE_KEY` too.

---

### Task 3: Harden the `send-bill-sms` edge function (auth + CORS)

**Why:** `supabase/functions/send-bill-sms/index.ts` is anon-callable with `Access-Control-Allow-Origin: "*"` and no caller authentication. Anyone who finds the URL can trigger WhatsApp template sends (spam + Meta API cost). This is the function the overhaul plan clones for order notifications (§5.3), so the pattern must be fixed before reuse.

**Files:**
- Modify: `supabase/functions/send-bill-sms/index.ts`

**Interfaces:**
- Consumes: Supabase-injected env `SUPABASE_URL`, `SUPABASE_ANON_KEY` (auto-present in the edge runtime), plus a new `ALLOWED_ORIGIN` secret.
- Produces: an authenticated, origin-restricted endpoint. Callers must send `Authorization: Bearer <admin JWT>`; the admin UI already sends the session JWT via supabase-js.

- [ ] **Step 1: Rewrite the function with a CORS allowlist and admin-JWT auth**

Replace the entire contents of `supabase/functions/send-bill-sms/index.ts` with:

```ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Comma-separated allowlist, e.g. "https://admin.example.com,http://localhost:3000".
const ALLOWED = (Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const CORS = corsHeaders(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // --- Auth: require a valid admin/superadmin JWT ---------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: CORS });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  if (!profile || !["admin", "superadmin"].includes(profile.role)) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: CORS });
  }

  // --- Original WhatsApp send logic (unchanged) -----------------------------
  try {
    const { phone, customerName, billNumber, amount, pdfUrl } = await req.json();

    if (!phone) return new Response(JSON.stringify({ error: "phone required" }), { status: 400, headers: CORS });

    const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");

    if (!phoneNumberId || !accessToken || !templateName) {
      return new Response(JSON.stringify({ error: "WhatsApp not configured" }), { status: 500, headers: CORS });
    }

    const normalized = phone.replace(/\D/g, "");

    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: normalized,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: customerName || "Customer" },
                { type: "text", text: String(billNumber) },
                { type: "text", text: String(amount) },
                { type: "text", text: pdfUrl || "" },
              ],
            },
          ],
        },
      }),
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      return new Response(
        JSON.stringify({ error: result.error?.message || "WhatsApp delivery failed" }),
        { status: 502, headers: CORS },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, channel: "whatsapp" }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
});
```

- [ ] **Step 2: Confirm the `profiles` id/role columns match**

The auth check assumes `profiles.id` (the auth user id) and `profiles.role`. Verify against live schema before deploying:

Run: `source .env && curl -s -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "$REACT_APP_SUPABASE_URL/rest/v1/rpc/get_schema_info" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');JSON.parse(d).filter(r=>r.table_name==='profiles').forEach(r=>console.log(r.column_name))"`
Expected: includes `id` and `role`. If the id column is named differently (e.g. `user_id`), update the `.eq(...)` in Step 1 accordingly before continuing.

- [ ] **Step 3: Set the `ALLOWED_ORIGIN` secret**

Set the admin origin(s) as a function secret. Use the admin URL from `.env` (`REACT_APP_ADMIN_URL`) plus localhost for dev:

Run: `source .env && supabase secrets set ALLOWED_ORIGIN="$REACT_APP_ADMIN_URL,http://localhost:3000"`
Expected: `Finished supabase secrets set`.

- [ ] **Step 4: Serve locally and verify an unauthenticated call is rejected**

Run: `supabase functions serve send-bill-sms` (in one terminal), then in another:

`curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:54321/functions/v1/send-bill-sms -H "Content-Type: application/json" -d '{"phone":"9999999999"}'`
Expected: `401` (no Authorization header → rejected before any WhatsApp call).

- [ ] **Step 5: Verify an authenticated admin call passes the auth gate**

Obtain a valid admin JWT (from the admin app: `supabase.auth.getSession()` in the browser console → copy `access_token`). Then:

`curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:54321/functions/v1/send-bill-sms -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" -d '{"phone":""}'`
Expected: `400` (`phone required`) — proves the request passed the 401/403 auth gate and reached the handler. (Using empty `phone` avoids sending a real WhatsApp message.)

- [ ] **Step 6: Deploy**

Run: `supabase functions deploy send-bill-sms`
Expected: `Deployed Function send-bill-sms`.

- [ ] **Step 7: Smoke-test the admin billing flow that calls this function**

In the admin app, send a real bill SMS/WhatsApp the way the UI normally does (the caller already attaches the session JWT). Confirm it still delivers — this proves the new auth gate does not block the legitimate authenticated path.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/send-bill-sms/index.ts
git commit -m "send-bill-sms: require admin JWT + restrict CORS to allowlisted origins"
```

---

### Task 4: Remove fake and dead storefront content

**Why (source: STOREFRONT-OVERHAUL-PLAN.md §1, §6 Phase 0):** Fake testimonials erode trust the moment a buyer googles a reviewer; a newsletter that fakes success stores nothing; dead About/Contact/Shipping/Returns links render blank (no 404 exists); the wishlist icon is a no-op; the "Worldwide" claim is unbacked (India-only at launch per §5.1). All are removed or corrected. Real replacements (brand-story section, footer-integrated newsletter, real About/Contact pages, business-legitimacy footer) are **Phase 1**, not here.

**Files:**
- Modify: `src/storefront/pages/HomePage.jsx`
- Delete: `src/storefront/components/home/ReviewsSection.jsx`
- Delete: `src/storefront/components/home/NewsletterSignup.jsx`
- Modify: `src/storefront/components/StorefrontHeader.jsx`
- Modify: `src/storefront/components/home/TrustBar.jsx`
- Modify: `src/storefront/components/StorefrontFooter.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

**Deliberately OUT of scope for Phase 0 (flag to owner, do NOT invent):**
- Placeholder footer phone `+91 98765 43210`, email `hello@bindalscreations.com`, and WhatsApp `wa.me/919876543210` — these need real business contact details (Phase 1 legitimacy footer, owner-supplied).
- Placeholder social links (`instagram.com`, `facebook.com` roots) — Phase 1.
- TrustBar's remaining claims — "Secure Checkout" (no checkout exists yet) and "Hassle-free 7-day returns" (open question #5: is 7-day the real policy?). §2.2 restructures/removes TrustBar entirely in Phase 1; Phase 0 touches only the "Worldwide" wording per the §6 Phase 0 bullet. Note both residual claims for the owner.

- [ ] **Step 1: Remove fake sections from the Home page**

In `src/storefront/pages/HomePage.jsx`, delete the two imports (lines 8–9):

```js
import ReviewsSection from "../components/home/ReviewsSection";
import NewsletterSignup from "../components/home/NewsletterSignup";
```

and delete their render lines (20–21):

```js
      <ReviewsSection />
      <NewsletterSignup />
```

The file should now render: `HeroBanner, TrustBar, CategoryShowcase, NewArrivals, FeaturedCollection, BestsellerGrid`.

- [ ] **Step 2: Delete the fake component files**

Run:

```bash
git rm src/storefront/components/home/ReviewsSection.jsx src/storefront/components/home/NewsletterSignup.jsx
```

- [ ] **Step 3: Verify no other file references the deleted components**

Run: `grep -rn "ReviewsSection\|NewsletterSignup" src/`
Expected: **no output** (Step 1 removed the only references).

- [ ] **Step 4: Remove dead nav links and the wishlist icon from the header**

In `src/storefront/components/StorefrontHeader.jsx`:

(a) Trim `NAV_LINKS` (lines 6–11) to only the real routes:

```js
const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Shop", to: "/shop" },
];
```

(b) Remove the no-op Wishlist button (lines 84–89):

```js
            <button
              aria-label="Wishlist"
              className="hidden sm:flex p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors cursor-pointer"
            >
              <Heart size={20} />
            </button>
```

(c) Remove the now-unused `Heart` import — change line 3 from:

```js
import { ShoppingBag, Search, Heart, Menu, X } from "lucide-react";
```

to:

```js
import { ShoppingBag, Search, Menu, X } from "lucide-react";
```

(d) Remove the "Worldwide delivery" clause from the announcement bar (lines 36–38). Change the inner text:

```js
        Free shipping on orders above ₹5,000 &nbsp;·&nbsp; Worldwide delivery
```

to:

```js
        Free shipping on orders above ₹5,000
```

Note: the `Search` icon button is intentionally kept — search is a planned v1 feature (STOREFRONT-OVERHAUL-PLAN §4 F1), not slop to remove. (It is currently a no-op; wiring it is Phase 1.)

- [ ] **Step 5: Correct the "Worldwide" claim in TrustBar**

In `src/storefront/components/home/TrustBar.jsx`, change the first signal (line 5) from:

```js
  { icon: Globe, title: "Worldwide Shipping", desc: "Free on orders above ₹5,000" },
```

to:

```js
  { icon: Globe, title: "Pan-India Shipping", desc: "Free on orders above ₹5,000" },
```

- [ ] **Step 6: Remove dead links from the footer Help column**

In `src/storefront/components/StorefrontFooter.jsx`, the Help column (lines 70–74) links to `/about`, `/contact`, and points Shipping/Returns at `/contact` — all nonexistent routes. Remove the dead entries. Replace the array literal (lines 70–74):

```js
              {[
                { label: "About Us", to: "/about" },
                { label: "Contact Us", to: "/contact" },
                { label: "Shipping Policy", to: "/contact" },
                { label: "Returns & Exchanges", to: "/contact" },
              ].map(({ label, to }) => (
```

with a single real link (Shop exists):

```js
              {[
                { label: "Shop All", to: "/shop" },
              ].map(({ label, to }) => (
```

Note: the Help column is intentionally left thin here; Phase 1 restores About/Contact/Shipping/Returns links once those pages exist.

- [ ] **Step 7: Verify no dead route links remain in storefront components**

Run: `grep -rn 'to="/about"\|to="/contact"' src/storefront/`
Expected: **no output**.

- [ ] **Step 8: Verify the app builds and Home renders without the removed sections**

Run: `npm run build`
Expected: build succeeds with no error about missing `ReviewsSection`, `NewsletterSignup`, or `Heart`.

Then run `npm start` and open `/`:
- Home shows Hero, TrustBar (now "Pan-India Shipping"), CategoryShowcase, NewArrivals, FeaturedCollection, BestsellerGrid — no testimonials, no newsletter section.
- Header shows only Home / Shop nav; no Wishlist heart; announcement bar reads "Free shipping on orders above ₹5,000".
- Footer Help column shows only "Shop All".

- [ ] **Step 9: Commit**

```bash
git add src/storefront/pages/HomePage.jsx src/storefront/components/StorefrontHeader.jsx src/storefront/components/home/TrustBar.jsx src/storefront/components/StorefrontFooter.jsx
git commit -m "Storefront: remove fake reviews/newsletter, dead links, wishlist no-op, worldwide claim"
```

---

## Post-Plan: keep the knowledge graph current

After the code changes land (Tasks 1, 3, 4 touch source files), refresh graphify per CLAUDE.md:

```bash
/opt/homebrew/opt/python@3.10/bin/python3.10 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
```

---

## Self-Review

**Spec coverage** (against STOREFRONT-OVERHAUL-PLAN.md §6 Phase 0 checklist):
- ✅ Fix `mockups_view` cost-price leak → Task 1 (revoke anon on view) — **plus** the newly-discovered direct `products.purchaseprice` leak (column grants).
- ✅ Rename `REACT_APP_SUPABASE_SERVICE_ROLE_KEY` out of browser bundle → Task 2.
- ✅ Fix `send-bill-sms` auth + CORS → Task 3.
- ✅ Remove fake reviews, fake newsletter success, dead About/Contact links, no-op wishlist icon, "worldwide" claim → Task 4.

**Corrections surfaced to spec** (per engineering-discipline "surface insights immediately"):
- The cost leak is not confined to `mockups_view`; anon reads `products.purchaseprice` directly. Task 1 fixes both. Update the audit/overhaul doc's framing.
- The service-role key is **not** currently in the shipped bundle (only referenced in `scripts/migrate.js`, never `src/`). It is a latent footgun, not an active leak. Task 2's rationale states this accurately.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" placeholders. Every code step shows the exact code; every verify step shows the exact command and expected output. The only intentional `<...>` tokens are runtime values a human must supply (product id, admin JWT, key value, admin URL) — flagged inline, not code to invent.

**Type/name consistency:** Column list `productid, name, description, categoryid, fabric, retailprice, producturl, unit_type` is identical between the migration (Task 1 Step 3) and the `useProduct` select (Task 1 Step 5). Env var `SUPABASE_SERVICE_ROLE_KEY` is used identically in `.env`, `migrate.js`, and CLAUDE.md (Task 2). The `send-bill-sms` auth assumes `profiles.id` / `profiles.role` — Task 3 Step 2 verifies these against live schema before deploy.

**Out-of-scope, explicitly noted:** footer placeholder contacts/socials, TrustBar "Secure Checkout"/"7-day returns" claims, and the no-op Search icon — all deferred to Phase 1 with rationale, so the owner isn't surprised by residual imperfections.
