# Storefront Phase 1 — Content/Brochure Slice (Design)

**Date:** 2026-07-10
**Branch:** `storefront-technical-slice` (continues from technical slice)
**Parent plan:** `docs/STOREFRONT-OVERHAUL-PLAN.md` §6 Phase 1
**Approach:** A — shared `StaticPage` shell + content-as-data modules (mirrors existing `faqContent.js`)

## Purpose

Complete the remaining Phase 1 items: the new brochure / legal / trust pages, header+footer wiring, and the Home restructure. These pages gate the Razorpay/Shiprocket merchant applications (which require live Shipping/Returns/Privacy/Terms pages on the domain), and remove the last dead nav/UI in the storefront.

Content is **scaffolded with clearly-marked placeholders** where real copy/photos aren't available yet; **real, owner-confirmed facts are used where they exist** (address, GSTIN, phone, dispatch/delivery times, exchange policy). Owner swaps placeholder → real by editing data modules, not JSX, before filing gateway applications.

## Scope

**In scope:**
- 7 new pages/routes: About, Contact, 4 policy pages, size guide
- Header nav wiring (add About/Contact; cut no-op Search icon)
- Footer wiring (Policies links; About/Contact/Size Guide links)
- Shared `StaticPage` shell extracted from the FaqPage pattern; FaqPage refactored onto it
- Home restructure to 5 sections (Hero, slim TrustBar, CategoryShowcase, NewArrivals, BrandStory); delete FeaturedCollection + BestsellerGrid

**Out of scope (with reason):**
- WhatsApp FAB — already exists (`StorefrontFooter.jsx:136`)
- Newsletter — already cut
- Checkout, and the TrustBar claims becoming *true* (free shipping / secure checkout) — Phase 2
- Size-guide-as-PDP-modal — deferred; PDP links to the `/size-guide` page instead
- Header search functionality — F1, not this slice (icon is removed, not implemented)

## §1 Routes + nav/footer wiring

**Routes** — add under `StorefrontLayout` in `src/App.js`, before the catch-all `*`:

| Route | Component (file) |
|---|---|
| `/about` | `AboutPage` (`src/storefront/pages/AboutPage.jsx`) |
| `/contact` | `ContactPage` (`src/storefront/pages/ContactPage.jsx`) |
| `/policies/shipping` | `ShippingPolicyPage` |
| `/policies/returns` | `ReturnsPolicyPage` |
| `/policies/privacy` | `PrivacyPolicyPage` |
| `/policies/terms` | `TermsPage` |
| `/size-guide` | `SizeGuidePage` |

Policy pages live in `src/storefront/pages/policies/`.

**Header** (`StorefrontHeader.jsx`):
- `NAV_LINKS` → `Home, Shop, About, Contact`. Mobile menu already maps `NAV_LINKS`, so it inherits automatically.
- Remove the no-op Search `<button>` (lines 76–81) and the `Search` import from `lucide-react`. `ShoppingBag` cart button stays.

**Footer** (`StorefrontFooter.jsx`):
- Add a **Policies** group (Shipping, Returns, Privacy, Terms). To preserve the existing 4-column `lg:grid-cols-4` rhythm, nest the policy links as a second list under the existing **Help** column (or add them below Shop All / FAQ). Final placement is a styling detail; the requirement is: all four policy routes are linked from the footer.
- Add **About**, **Contact**, **Size Guide** links to the Help column.

## §2 Shared `StaticPage` shell + content-as-data

Extract `src/storefront/components/StaticPage.jsx` from the header/container pattern currently inline in `FaqPage.jsx`:

```jsx
<StaticPage eyebrow="Policy" title="Shipping Policy" seoDescription="...">
  {children}
</StaticPage>
```

Renders: `min-h-[60vh]` cream background, `max-w-3xl` centered container with the standard page padding, gold eyebrow strip (`h-px` rule + tracked uppercase label), display `h1`, and a `<Seo title description>`. Children render below the `h1`.

- **FaqPage is refactored onto `StaticPage`** — removes the duplicated header/container markup and proves the shell has the right interface.
- Page copy lives in data modules alongside `faqContent.js`. Components stay thin: read module → render through shell.

**Isolation:** `StaticPage` owns page chrome (bg, container, eyebrow, title, SEO); it knows nothing about any page's content. Content modules own copy and know nothing about layout. Each page component wires one to the other.

## §3 Policy pages (4)

Content in `src/storefront/pages/policies/policyContent.js`, exporting `SHIPPING`, `RETURNS`, `PRIVACY`, `TERMS`. Each is an array of `{ heading, body: string[] }` sections. A small local `PolicySection` renders `heading` + paragraphs. Each page component is a thin wrapper:

```jsx
export default function ShippingPolicyPage() {
  return (
    <StaticPage eyebrow="Policy" title="Shipping Policy" seoDescription="...">
      {SHIPPING.map((s) => <PolicySection key={s.heading} {...s} />)}
    </StaticPage>
  );
}
```

Content sourcing:
- **Shipping** — real facts: dispatch within 2 working days; delivery across India in 5–7 days after dispatch; free shipping above ₹5,000; India-only at launch. Orders below ₹5,000 carry a shipping charge calculated by the courier aggregator based on delivery location, shown at checkout (not a flat rate). Pre-checkout, word this as "calculated at checkout by delivery location" — becomes live when Phase 2 checkout + Shiprocket ships.
- **Returns/Exchange** — real facts: no returns; exchange within 7 days of purchase, in-store only, unworn/original condition with tags.
- **Privacy** — placeholder boilerplate, marked `[PLACEHOLDER — needs owner/legal review]`.
- **Terms** — placeholder boilerplate, same marking.

All placeholder text carries a visible marker so it can't be mistaken for final copy or shipped to the gateway unreviewed.

## §4 About page

`AboutPage.jsx` + `aboutContent.js` (placeholder copy + image slots). Its own layout — wider than the `max-w-3xl` policy shell to accommodate imagery — reusing the eyebrow strip and `<Seo>` primitives (extract the eyebrow into a tiny `Eyebrow` component if it's needed in more than two places; otherwise inline). Sections:
- Intro (eyebrow + display title + lede)
- Brand-story prose block
- Craftsmanship block with one image placeholder
- Small values strip (e.g. 3 short pillars)

## §5 Contact page

`ContactPage.jsx`. Two-column on desktop, stacked on mobile:
- **Left:** address (58 Sihani Gate Market, Ghaziabad 201001), phone (+91 98108 73280), WhatsApp link, email (bindalscreations@gmail.com), store hours (8 AM–8 PM daily, closed Tuesdays). All real facts.
- **Right:** Google Maps **embed iframe** using the real address via `https://www.google.com/maps?q=<address>&output=embed` (no API key, no external SDK), plus placeholder store-photo slots.

Reuses `<Seo>` and eyebrow primitives.

## §6 Size guide

`SizeGuidePage.jsx` + `sizeGuideContent.js` (placeholder). Sections:
- How-to-measure intro
- Measurement table: rows bust/waist/hip, columns S/M/L/XL, placeholder cm values
- Diagram image placeholder

**PDP link:** in `ProductDetailPage.jsx`, add a plain "Size guide" link → `/size-guide` near the variant/size picker. Modal variant deferred.

## §7 Home restructure

`HomePage.jsx` renders, in order: `HeroBanner`, `TrustBar` (slimmed), `CategoryShowcase`, `NewArrivals`, and a new `src/storefront/components/home/BrandStory.jsx` (short brand-story text + one placeholder image + CTA linking to `/about`). 5 sections.

- **TrustBar** — keep, but edit `SIGNALS` to drop the "Secure Checkout" claim (untrue until Phase 2 checkout ships). Remaining 3: Pan-India Shipping (free above ₹5,000), 100% Authentic (sourced from artisans), 7-Day Exchange (in-store within 7 days). Grid `lg:grid-cols-4` → `lg:grid-cols-3`. Re-add Secure Checkout in Phase 2.
- **FeaturedCollection** — delete. It's a static banner with invented stats ("500+ designs / 25+ years / 10k+ happy brides") and no product data — pure slop. A real seasonal collection is deferred (would need a curation source; explicitly out of scope).
- **BestsellerGrid** — delete. Mislabeled ("Curated Picks / Handpicked") but its query is `order by productid desc limit 6` = newest products, i.e. a dishonest duplicate of NewArrivals.
- Grep for other importers of `FeaturedCollection`/`BestsellerGrid` before deleting; expected only `HomePage`. If imported elsewhere, leave and note it.

## §8 Testing (TDD)

Contract/wiring tests, not prose assertions (placeholder copy will churn). React Testing Library + `MemoryRouter` (the `react-router-dom` jest mapper is already fixed — see technical-slice memory). Command: `CI=true npx react-scripts test <path> --watchAll=false`.

- Each new page renders its `h1` and does not crash.
- `StaticPage` renders the eyebrow, title, and children it is given.
- Header nav includes About and Contact links; there is **no** Search button.
- Footer contains links to all four policy routes.
- Home renders the 5 intended sections (assert BrandStory + TrustBar present; FeaturedCollection/BestsellerGrid absent). TrustBar renders 3 signals, no "Secure Checkout".

## Design decisions

- **Approach A over a single generic `ContentPage`:** the pages diverge (map, measurement table, image-led story vs. legal prose). One shared shell for chrome + per-page components keeps each file single-responsibility and safe to edit as content is swapped.
- **Content-as-data modules:** directly serves the placeholder→real swap workflow and matches the established `faqContent.js` precedent.
- **Real facts where confirmed, marked placeholders elsewhere:** avoids shipping fake policy text; keeps the pages honest per the overhaul's anti-slop principle; makes unreviewed content obvious before gateway filing.
- **Google Maps embed by URL, not JS SDK:** no API key, no external script, strong physical-store trust signal.

## Verification

- `npm run build` succeeds.
- New test files pass via the command above; existing storefront tests still green (esp. refactored FaqPage).
- Manual: `npm start`, visit each new route, click every new nav/footer link (no 404s), confirm Home shows 4 sections, confirm no Search icon in header, confirm placeholder markers are visible on unreviewed content.
