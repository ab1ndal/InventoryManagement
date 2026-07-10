# Storefront Brochure Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining Phase 1 storefront brochure/legal/trust pages (About, Contact, 4 policy pages, size guide), wire nav + footer, and restructure Home — so the Razorpay/Shiprocket merchant applications can be filed.

**Architecture:** Approach A — a shared `StaticPage` shell (extracted from the existing FaqPage pattern) renders page chrome (cream bg, container, gold eyebrow, display title, SEO). The 4 legal pages are thin components reading `{heading, body[]}` sections from a content-as-data module. About / Contact / size-guide have distinct layouts but reuse the eyebrow + `<Seo>` primitives. Placeholder copy is clearly marked; owner-confirmed real facts are used where they exist. Owner swaps placeholder→real by editing data modules, never JSX.

**Tech Stack:** React 19 (native document metadata via existing `Seo`), react-router-dom v7, Tailwind (storefront-* theme tokens), React Testing Library + jsdom.

## Global Constraints

- All storefront styling uses existing theme tokens: `storefront-cream`, `storefront-charcoal`, `storefront-gold`, `storefront-gold-dark`, `storefront-border`, `storefront-muted`, `storefront-warm`; fonts `font-display` (Fraunces) + `font-sans` (Inter).
- SEO via the existing `src/storefront/components/Seo.jsx` (`title`, `description`, `type`, `noindex`, `jsonLd`). No `react-helmet`.
- Test command: `CI=true npx react-scripts test <path> --watchAll=false`.
- Tests that render components using `<Link>`/`<NavLink>` MUST wrap in `<MemoryRouter>` (jest mapper for `react-router-dom` is already fixed in package.json).
- Placeholder copy MUST carry a visible marker string `[PLACEHOLDER — needs owner/legal review]` so it can't be mistaken for final content.
- Real facts (verbatim): dispatch within 2 working days; delivery across India in 5–7 days after dispatch; free shipping above ₹5,000; India-only; no returns, exchange within 7 days in-store only (unworn, tags intact); address `58 Sihani Gate Market, Ghaziabad 201001`; phone `+91 98108 73280` (`wa.me/919810873280`); email `bindalscreations@gmail.com`; GSTIN `09ABVPB4203A1Z4`; store hours 8 AM–8 PM daily, closed Tuesdays.
- Commit after each task with a message prefixed `Storefront brochure:`.

---

## File structure

**Create:**
- `src/storefront/components/StaticPage.jsx` — page shell
- `src/storefront/pages/policies/policyContent.js` — SHIPPING/RETURNS/PRIVACY/TERMS data
- `src/storefront/pages/policies/PolicySection.jsx` — heading + paragraphs renderer
- `src/storefront/pages/policies/ShippingPolicyPage.jsx`
- `src/storefront/pages/policies/ReturnsPolicyPage.jsx`
- `src/storefront/pages/policies/PrivacyPolicyPage.jsx`
- `src/storefront/pages/policies/TermsPage.jsx`
- `src/storefront/pages/aboutContent.js`
- `src/storefront/pages/AboutPage.jsx`
- `src/storefront/pages/ContactPage.jsx`
- `src/storefront/pages/sizeGuideContent.js`
- `src/storefront/pages/SizeGuidePage.jsx`
- `src/storefront/components/home/BrandStory.jsx`
- Test files under `src/storefront/__tests__/`

**Modify:**
- `src/App.js` — imports + routes
- `src/storefront/pages/FaqPage.jsx` — refactor onto StaticPage
- `src/storefront/components/StorefrontHeader.jsx` — nav links, remove Search
- `src/storefront/components/StorefrontFooter.jsx` — policy/page links
- `src/storefront/pages/ProductDetailPage.jsx` — size-guide link
- `src/storefront/components/home/TrustBar.jsx` — drop Secure Checkout, 3-col
- `src/storefront/pages/HomePage.jsx` — restructure
- `src/storefront/__tests__/TrustBar.test.jsx` — update expectations

**Delete:**
- `src/storefront/components/home/FeaturedCollection.jsx`
- `src/storefront/components/home/BestsellerGrid.jsx`

---

## Task 1: StaticPage shell + refactor FaqPage

**Files:**
- Create: `src/storefront/components/StaticPage.jsx`
- Modify: `src/storefront/pages/FaqPage.jsx`
- Test: `src/storefront/__tests__/StaticPage.test.jsx`
- Existing test that must still pass: `src/storefront/__tests__/FaqPage.test.jsx`

**Interfaces:**
- Produces: `StaticPage({ eyebrow?, title, seoTitle?, seoDescription?, children })` — default export. Renders cream page, `max-w-3xl` container, optional gold eyebrow, display `h1` with `title`, `<Seo title={seoTitle||title} description={seoDescription} />`, then `children`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/StaticPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import StaticPage from "../components/StaticPage";

describe("StaticPage", () => {
  it("renders eyebrow, title heading, and children", () => {
    render(
      <StaticPage eyebrow="Policy" title="Shipping Policy" seoDescription="desc">
        <p>Body content here</p>
      </StaticPage>
    );
    expect(screen.getByText("Policy")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shipping Policy" })).toBeInTheDocument();
    expect(screen.getByText("Body content here")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StaticPage.test.jsx --watchAll=false`
Expected: FAIL — cannot find module `../components/StaticPage`.

- [ ] **Step 3: Create StaticPage**

```jsx
// src/storefront/components/StaticPage.jsx
import React from "react";
import Seo from "./Seo";

export default function StaticPage({ eyebrow, title, seoTitle, seoDescription, children }) {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo title={seoTitle || title} description={seoDescription} />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {eyebrow && (
          <div className="flex items-center gap-3 mb-3">
            <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
            <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
              {eyebrow}
            </span>
          </div>
        )}
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-10">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Refactor FaqPage onto StaticPage**

Replace the entire contents of `src/storefront/pages/FaqPage.jsx` with:

```jsx
import React from "react";
import StaticPage from "../components/StaticPage";
import { FAQ_ITEMS } from "./faqContent";

function FaqItem({ q, a }) {
  return (
    <details className="group border-b border-storefront-border py-5">
      <summary className="flex items-start justify-between gap-4 cursor-pointer list-none font-display text-lg text-storefront-charcoal">
        <span>{q}</span>
        <span className="text-storefront-gold text-xl leading-none flex-shrink-0 transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm text-storefront-muted font-sans leading-relaxed">
        {a}
      </p>
    </details>
  );
}

export default function FaqPage() {
  return (
    <StaticPage
      eyebrow="Help"
      title="Frequently Asked Questions"
      seoTitle="FAQ"
      seoDescription="Answers to common questions about delivery, exchanges, payments, sizing, and visiting Bindal's Creations."
    >
      <div>
        {FAQ_ITEMS.map((item) => (
          <FaqItem key={item.q} q={item.q} a={item.a} />
        ))}
      </div>
    </StaticPage>
  );
}
```

- [ ] **Step 5: Run both tests to verify they pass**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StaticPage.test.jsx src/storefront/__tests__/FaqPage.test.jsx --watchAll=false`
Expected: PASS (both files).

- [ ] **Step 6: Commit**

```bash
git add src/storefront/components/StaticPage.jsx src/storefront/pages/FaqPage.jsx src/storefront/__tests__/StaticPage.test.jsx
git commit -m "Storefront brochure: extract StaticPage shell, refactor FaqPage onto it"
```

---

## Task 2: Policy pages (4) + routes

**Files:**
- Create: `src/storefront/pages/policies/policyContent.js`, `PolicySection.jsx`, `ShippingPolicyPage.jsx`, `ReturnsPolicyPage.jsx`, `PrivacyPolicyPage.jsx`, `TermsPage.jsx`
- Modify: `src/App.js` (imports + routes)
- Test: `src/storefront/__tests__/policyPages.test.jsx`

**Interfaces:**
- Consumes: `StaticPage` (Task 1).
- Produces: default exports `ShippingPolicyPage`, `ReturnsPolicyPage`, `PrivacyPolicyPage`, `TermsPage`; `PolicySection({ heading, body })`; named exports `SHIPPING`, `RETURNS`, `PRIVACY`, `TERMS` (arrays of `{ heading: string, body: string[] }`).

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/policyPages.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import ShippingPolicyPage from "../pages/policies/ShippingPolicyPage";
import ReturnsPolicyPage from "../pages/policies/ReturnsPolicyPage";
import PrivacyPolicyPage from "../pages/policies/PrivacyPolicyPage";
import TermsPage from "../pages/policies/TermsPage";

describe("Policy pages", () => {
  it("shipping page states real dispatch and free-shipping facts", () => {
    render(<ShippingPolicyPage />);
    expect(screen.getByRole("heading", { name: /shipping policy/i })).toBeInTheDocument();
    expect(screen.getByText(/dispatch within 2 working days/i)).toBeInTheDocument();
    expect(screen.getByText(/free.*above ₹5,000/i)).toBeInTheDocument();
  });

  it("returns page states no-returns / 7-day in-store exchange", () => {
    render(<ReturnsPolicyPage />);
    expect(screen.getByRole("heading", { name: /returns.*exchange/i })).toBeInTheDocument();
    expect(screen.getByText(/exchange within 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/in-store only/i)).toBeInTheDocument();
  });

  it("privacy and terms render with review markers", () => {
    const { unmount } = render(<PrivacyPolicyPage />);
    expect(screen.getByRole("heading", { name: /privacy policy/i })).toBeInTheDocument();
    expect(screen.getAllByText(/needs owner\/legal review/i).length).toBeGreaterThan(0);
    unmount();
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: /terms/i })).toBeInTheDocument();
    expect(screen.getAllByText(/needs owner\/legal review/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/policyPages.test.jsx --watchAll=false`
Expected: FAIL — cannot find `../pages/policies/ShippingPolicyPage`.

- [ ] **Step 3: Create the content module**

```js
// src/storefront/pages/policies/policyContent.js
// Real facts owner-confirmed 2026-07-09/10. Privacy + Terms are placeholder
// boilerplate flagged for owner/legal review before the payment-gateway filing.
const REVIEW = "[PLACEHOLDER — needs owner/legal review]";

export const SHIPPING = [
  {
    heading: "Dispatch & delivery",
    body: [
      "We dispatch orders within 2 working days.",
      "Delivery anywhere in India typically takes 5–7 days after dispatch.",
    ],
  },
  {
    heading: "Shipping charges",
    body: [
      "Shipping is free on orders above ₹5,000.",
      "For orders below ₹5,000, the shipping charge is calculated at checkout based on your delivery location.",
    ],
  },
  {
    heading: "Serviceable regions",
    body: [
      "We currently ship across India only. We do not offer international shipping at this time.",
    ],
  },
];

export const RETURNS = [
  {
    heading: "Returns",
    body: ["We do not offer returns."],
  },
  {
    heading: "Exchanges",
    body: [
      "Exchanges are accepted within 7 days of purchase, in-store only.",
      "The garment must be unworn and in original condition with tags intact.",
    ],
  },
  {
    heading: "How to exchange",
    body: [
      "Visit us at 58 Sihani Gate Market, Ghaziabad 201001 with the garment and your proof of purchase. Message us on WhatsApp at +91 98108 73280 before visiting if you have any questions.",
    ],
  },
];

export const PRIVACY = [
  {
    heading: "Information we collect",
    body: [
      `${REVIEW} Describe what personal data is collected at checkout (name, contact, shipping address) and via the site.`,
    ],
  },
  {
    heading: "How we use your information",
    body: [`${REVIEW} Describe order fulfilment, delivery, and support use of data.`],
  },
  {
    heading: "Data sharing & contact",
    body: [
      `${REVIEW} Describe sharing with couriers/payment processors and how to contact us about data. Contact: bindalscreations@gmail.com.`,
    ],
  },
];

export const TERMS = [
  {
    heading: "Use of this website",
    body: [`${REVIEW} Describe acceptable use and product/pricing accuracy terms.`],
  },
  {
    heading: "Orders & payment",
    body: [`${REVIEW} Describe order acceptance, pricing, and payment terms.`],
  },
  {
    heading: "Governing law & contact",
    body: [
      `${REVIEW} State governing jurisdiction (India). Contact: bindalscreations@gmail.com.`,
    ],
  },
];
```

- [ ] **Step 4: Create PolicySection**

```jsx
// src/storefront/pages/policies/PolicySection.jsx
import React from "react";

export default function PolicySection({ heading, body }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-semibold text-storefront-charcoal mb-3">
        {heading}
      </h2>
      {body.map((para, i) => (
        <p
          key={i}
          className="text-sm text-storefront-muted font-sans leading-relaxed mb-3"
        >
          {para}
        </p>
      ))}
    </section>
  );
}
```

- [ ] **Step 5: Create the four page components**

```jsx
// src/storefront/pages/policies/ShippingPolicyPage.jsx
import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { SHIPPING } from "./policyContent";

export default function ShippingPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Shipping Policy"
      seoDescription="How and when Bindal's Creations dispatches and delivers orders across India."
    >
      {SHIPPING.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
```

```jsx
// src/storefront/pages/policies/ReturnsPolicyPage.jsx
import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { RETURNS } from "./policyContent";

export default function ReturnsPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Returns & Exchange"
      seoDescription="Our exchange policy: 7-day in-store exchange on unworn items. No returns."
    >
      {RETURNS.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
```

```jsx
// src/storefront/pages/policies/PrivacyPolicyPage.jsx
import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { PRIVACY } from "./policyContent";

export default function PrivacyPolicyPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Privacy Policy"
      seoDescription="How Bindal's Creations handles your personal information."
    >
      {PRIVACY.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
```

```jsx
// src/storefront/pages/policies/TermsPage.jsx
import React from "react";
import StaticPage from "../../components/StaticPage";
import PolicySection from "./PolicySection";
import { TERMS } from "./policyContent";

export default function TermsPage() {
  return (
    <StaticPage
      eyebrow="Policy"
      title="Terms of Service"
      seoDescription="The terms governing use of the Bindal's Creations website and orders."
    >
      {TERMS.map((s) => (
        <PolicySection key={s.heading} {...s} />
      ))}
    </StaticPage>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/policyPages.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 7: Wire routes in App.js**

In `src/App.js`, add imports after line 13 (`import NotFoundPage ...`):

```jsx
import ShippingPolicyPage from "./storefront/pages/policies/ShippingPolicyPage";
import ReturnsPolicyPage from "./storefront/pages/policies/ReturnsPolicyPage";
import PrivacyPolicyPage from "./storefront/pages/policies/PrivacyPolicyPage";
import TermsPage from "./storefront/pages/policies/TermsPage";
```

Inside the storefront `<Route path="/" element={<StorefrontLayout />}>` block, add these routes immediately after the `faq` route (before the `path="*"` catch-all):

```jsx
            <Route path="policies/shipping" element={<ShippingPolicyPage />} />
            <Route path="policies/returns" element={<ReturnsPolicyPage />} />
            <Route path="policies/privacy" element={<PrivacyPolicyPage />} />
            <Route path="policies/terms" element={<TermsPage />} />
```

- [ ] **Step 8: Verify build compiles**

Run: `npm run build`
Expected: build succeeds (no unresolved imports).

- [ ] **Step 9: Commit**

```bash
git add src/storefront/pages/policies src/storefront/__tests__/policyPages.test.jsx src/App.js
git commit -m "Storefront brochure: 4 policy pages + routes"
```

---

## Task 3: About page + route

**Files:**
- Create: `src/storefront/pages/aboutContent.js`, `src/storefront/pages/AboutPage.jsx`
- Modify: `src/App.js`
- Test: `src/storefront/__tests__/AboutPage.test.jsx`

**Interfaces:**
- Consumes: `Seo`.
- Produces: default export `AboutPage`; named export `ABOUT` (`{ eyebrow, title, lede, story: string[], craftsmanship: { title, body: string[] }, values: { title, desc }[] }`).

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/AboutPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AboutPage from "../pages/AboutPage";

describe("AboutPage", () => {
  it("renders the story heading and a link to shop", () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { name: /our story/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /shop the collection/i })).toHaveAttribute("href", "/shop");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/AboutPage.test.jsx --watchAll=false`
Expected: FAIL — cannot find `../pages/AboutPage`.

- [ ] **Step 3: Create content module**

```js
// src/storefront/pages/aboutContent.js
// Placeholder brand-story copy — owner to replace with the real family/city/
// since-when story and photography before launch.
const REVIEW = "[PLACEHOLDER — needs owner/legal review]";

export const ABOUT = {
  eyebrow: "Our Story",
  title: "Our Story",
  lede: `${REVIEW} One or two sentences on who Bindal's Creations is — a family-run ethnic-wear house rooted in Ghaziabad.`,
  story: [
    `${REVIEW} The founding story: which family, which city, since when, and why sarees and lehengas.`,
    `${REVIEW} What the store stands for today, and the relationship with the customers who visit in person.`,
  ],
  craftsmanship: {
    title: "Craftsmanship",
    body: [
      `${REVIEW} How pieces are sourced directly from artisans, and the work/embroidery traditions behind them.`,
    ],
  },
  values: [
    { title: "Sourced with care", desc: `${REVIEW} Short line on sourcing.` },
    { title: "A real store", desc: "Visit us in person at Sihani Gate Market, Ghaziabad." },
    { title: "Here to help", desc: "Message us on WhatsApp anytime before you buy." },
  ],
};
```

- [ ] **Step 4: Create AboutPage**

```jsx
// src/storefront/pages/AboutPage.jsx
import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";
import { ABOUT } from "./aboutContent";

function Eyebrow({ label }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
      <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
        {label}
      </span>
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo
        title="About"
        description="The story behind Bindal's Creations — a family-run ethnic-wear house in Ghaziabad."
      />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        {/* Intro */}
        <Eyebrow label={ABOUT.eyebrow} />
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-5">
          {ABOUT.title}
        </h1>
        <p className="font-sans text-base text-storefront-muted leading-relaxed max-w-2xl mb-12">
          {ABOUT.lede}
        </p>

        {/* Story */}
        <div className="max-w-2xl space-y-4 mb-14">
          {ABOUT.story.map((para, i) => (
            <p key={i} className="font-sans text-sm text-storefront-charcoal leading-relaxed">
              {para}
            </p>
          ))}
        </div>

        {/* Craftsmanship with image placeholder */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center mb-14">
          <div>
            <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">
              {ABOUT.craftsmanship.title}
            </h2>
            {ABOUT.craftsmanship.body.map((para, i) => (
              <p key={i} className="font-sans text-sm text-storefront-muted leading-relaxed mb-3">
                {para}
              </p>
            ))}
          </div>
          <div className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide">
            [Craftsmanship / artisan photo]
          </div>
        </div>

        {/* Values */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 border-t border-storefront-border pt-10 mb-12">
          {ABOUT.values.map((v) => (
            <div key={v.title}>
              <h3 className="font-display text-lg text-storefront-charcoal mb-1">{v.title}</h3>
              <p className="font-sans text-sm text-storefront-muted leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>

        <Link
          to="/shop"
          className="inline-flex items-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-sans text-sm font-medium tracking-widest uppercase px-10 py-3.5 transition-colors duration-200"
        >
          Shop the Collection
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/AboutPage.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Wire route in App.js**

Add import after the policy imports:

```jsx
import AboutPage from "./storefront/pages/AboutPage";
```

Add route in the storefront block (after `faq`, before catch-all):

```jsx
            <Route path="about" element={<AboutPage />} />
```

- [ ] **Step 7: Commit**

```bash
git add src/storefront/pages/AboutPage.jsx src/storefront/pages/aboutContent.js src/storefront/__tests__/AboutPage.test.jsx src/App.js
git commit -m "Storefront brochure: About page + route"
```

---

## Task 4: Contact page + route

**Files:**
- Create: `src/storefront/pages/ContactPage.jsx`
- Modify: `src/App.js`
- Test: `src/storefront/__tests__/ContactPage.test.jsx`

**Interfaces:**
- Consumes: `Seo`.
- Produces: default export `ContactPage`.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/ContactPage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import ContactPage from "../pages/ContactPage";

describe("ContactPage", () => {
  it("shows address, hours, and a WhatsApp link", () => {
    render(<ContactPage />);
    expect(screen.getByRole("heading", { name: /visit us|contact/i })).toBeInTheDocument();
    expect(screen.getByText(/58 Sihani Gate Market/i)).toBeInTheDocument();
    expect(screen.getByText(/closed tuesdays/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /whatsapp/i })).toHaveAttribute(
      "href",
      expect.stringContaining("wa.me/919810873280")
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/ContactPage.test.jsx --watchAll=false`
Expected: FAIL — cannot find `../pages/ContactPage`.

- [ ] **Step 3: Create ContactPage**

```jsx
// src/storefront/pages/ContactPage.jsx
import React from "react";
import Seo from "../components/Seo";
import { MapPin, Phone, Mail, MessageCircle, Clock } from "lucide-react";

const ADDRESS = "58 Sihani Gate Market, Ghaziabad 201001";
const MAP_SRC = `https://www.google.com/maps?q=${encodeURIComponent(ADDRESS)}&output=embed`;

export default function ContactPage() {
  return (
    <div className="min-h-[60vh] bg-storefront-cream">
      <Seo
        title="Contact & Store"
        description="Visit Bindal's Creations at 58 Sihani Gate Market, Ghaziabad. Call or WhatsApp us any day 8 AM–8 PM (closed Tuesdays)."
      />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Visit
          </span>
        </div>
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-10">
          Visit Us
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-14">
          {/* Left: details */}
          <div className="space-y-6 font-sans text-sm text-storefront-charcoal">
            <div className="flex items-start gap-3">
              <MapPin size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <span>{ADDRESS}</span>
            </div>
            <div className="flex items-start gap-3">
              <Clock size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <span>Open 8 AM – 8 PM every day. Closed Tuesdays.</span>
            </div>
            <div className="flex items-start gap-3">
              <Phone size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <a href="tel:+919810873280" className="hover:text-storefront-gold transition-colors">
                +91 98108 73280
              </a>
            </div>
            <div className="flex items-start gap-3">
              <MessageCircle size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <a
                href="https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-storefront-gold transition-colors"
              >
                WhatsApp us
              </a>
            </div>
            <div className="flex items-start gap-3">
              <Mail size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <a
                href="mailto:bindalscreations@gmail.com"
                className="hover:text-storefront-gold transition-colors"
              >
                bindalscreations@gmail.com
              </a>
            </div>

            {/* Store photo placeholders */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              {["Storefront photo", "Interior photo"].map((label) => (
                <div
                  key={label}
                  className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-[11px] tracking-wide text-center px-2"
                >
                  [{label}]
                </div>
              ))}
            </div>
          </div>

          {/* Right: map */}
          <div className="min-h-[320px]">
            <iframe
              title="Bindal's Creations store location"
              src={MAP_SRC}
              className="w-full h-full min-h-[320px] rounded-sm border border-storefront-border"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/ContactPage.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Wire route in App.js**

Add import:

```jsx
import ContactPage from "./storefront/pages/ContactPage";
```

Add route in the storefront block:

```jsx
            <Route path="contact" element={<ContactPage />} />
```

- [ ] **Step 6: Commit**

```bash
git add src/storefront/pages/ContactPage.jsx src/storefront/__tests__/ContactPage.test.jsx src/App.js
git commit -m "Storefront brochure: Contact page with map + store info"
```

---

## Task 5: Size guide page + route + PDP link

**Files:**
- Create: `src/storefront/pages/sizeGuideContent.js`, `src/storefront/pages/SizeGuidePage.jsx`
- Modify: `src/App.js`, `src/storefront/pages/ProductDetailPage.jsx`
- Test: `src/storefront/__tests__/SizeGuidePage.test.jsx`

**Interfaces:**
- Consumes: `StaticPage`.
- Produces: default export `SizeGuidePage`; named exports `MEASURE_INTRO` (string[]), `SIZE_ROWS` (`{ label, S, M, L, XL }[]`).

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/SizeGuidePage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import SizeGuidePage from "../pages/SizeGuidePage";

describe("SizeGuidePage", () => {
  it("renders the heading and a measurement table with size columns", () => {
    render(<SizeGuidePage />);
    expect(screen.getByRole("heading", { name: /size guide/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "M" })).toBeInTheDocument();
    expect(screen.getByText(/bust/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/SizeGuidePage.test.jsx --watchAll=false`
Expected: FAIL — cannot find `../pages/SizeGuidePage`.

- [ ] **Step 3: Create content module**

```js
// src/storefront/pages/sizeGuideContent.js
// Placeholder measurements — owner to replace with the store's real size chart.
const REVIEW = "[PLACEHOLDER — needs owner/legal review]";

export const MEASURE_INTRO = [
  "Measure over your undergarments, keeping the tape snug but not tight.",
  `${REVIEW} Replace the values below with the store's real size chart (in cm or inches).`,
];

export const SIZE_ROWS = [
  { label: "Bust", S: "—", M: "—", L: "—", XL: "—" },
  { label: "Waist", S: "—", M: "—", L: "—", XL: "—" },
  { label: "Hip", S: "—", M: "—", L: "—", XL: "—" },
];
```

- [ ] **Step 4: Create SizeGuidePage**

```jsx
// src/storefront/pages/SizeGuidePage.jsx
import React from "react";
import StaticPage from "../components/StaticPage";
import { MEASURE_INTRO, SIZE_ROWS } from "./sizeGuideContent";

const SIZES = ["S", "M", "L", "XL"];

export default function SizeGuidePage() {
  return (
    <StaticPage
      eyebrow="Sizing"
      title="Size Guide"
      seoDescription="How to measure and choose the right size at Bindal's Creations. Unsure? Message us on WhatsApp."
    >
      <div className="space-y-4 mb-8">
        {MEASURE_INTRO.map((para, i) => (
          <p key={i} className="text-sm text-storefront-muted font-sans leading-relaxed">
            {para}
          </p>
        ))}
      </div>

      <div className="overflow-x-auto mb-8">
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="border-b border-storefront-border text-left">
              <th className="py-2 pr-4 font-display font-semibold text-storefront-charcoal">
                Measurement
              </th>
              {SIZES.map((s) => (
                <th
                  key={s}
                  scope="col"
                  className="py-2 px-3 font-display font-semibold text-storefront-charcoal text-center"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SIZE_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-storefront-border/60">
                <td className="py-2 pr-4 text-storefront-charcoal">{row.label}</td>
                {SIZES.map((s) => (
                  <td key={s} className="py-2 px-3 text-center text-storefront-muted tabular-nums">
                    {row[s]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="aspect-[16/9] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide mb-6">
        [Measurement diagram]
      </div>

      <p className="text-sm text-storefront-muted font-sans leading-relaxed">
        Still unsure? Message us on WhatsApp at{" "}
        <a
          href="https://wa.me/919810873280?text=Hi,%20I%20need%20help%20with%20sizing"
          target="_blank"
          rel="noopener noreferrer"
          className="text-storefront-gold hover:underline"
        >
          +91 98108 73280
        </a>{" "}
        with your measurements and we'll help you pick the right fit.
      </p>
    </StaticPage>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/SizeGuidePage.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Add PDP link to the size guide**

In `src/storefront/pages/ProductDetailPage.jsx`, ensure `Link` is imported from `react-router-dom` (it already is — used for the breadcrumb). Inside the `<div className="border-t border-storefront-border pt-6 mb-6">` block, immediately after the closing of the `variants.length > 0 ? (...) : (...)` conditional (i.e. right before that div closes), add:

```jsx
              <Link
                to="/size-guide"
                className="inline-block mt-4 text-xs font-sans tracking-wide text-storefront-muted hover:text-storefront-gold underline underline-offset-2 transition-colors"
              >
                Size guide
              </Link>
```

- [ ] **Step 7: Wire route in App.js**

Add import:

```jsx
import SizeGuidePage from "./storefront/pages/SizeGuidePage";
```

Add route in the storefront block:

```jsx
            <Route path="size-guide" element={<SizeGuidePage />} />
```

- [ ] **Step 8: Verify build compiles**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/storefront/pages/SizeGuidePage.jsx src/storefront/pages/sizeGuideContent.js src/storefront/__tests__/SizeGuidePage.test.jsx src/storefront/pages/ProductDetailPage.jsx src/App.js
git commit -m "Storefront brochure: Size guide page + PDP link + route"
```

---

## Task 6: Header nav wiring + remove no-op Search

**Files:**
- Modify: `src/storefront/components/StorefrontHeader.jsx`
- Test: `src/storefront/__tests__/StorefrontHeader.test.jsx`

**Interfaces:**
- Consumes: `CartProvider`, `useCart` (existing).

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/StorefrontHeader.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CartProvider } from "../context/CartContext";
import StorefrontHeader from "../components/StorefrontHeader";

function renderHeader() {
  render(
    <MemoryRouter>
      <CartProvider>
        <StorefrontHeader />
      </CartProvider>
    </MemoryRouter>
  );
}

describe("StorefrontHeader", () => {
  it("links to About and Contact", () => {
    renderHeader();
    expect(screen.getAllByRole("link", { name: "About" })[0]).toHaveAttribute("href", "/about");
    expect(screen.getAllByRole("link", { name: "Contact" })[0]).toHaveAttribute("href", "/contact");
  });

  it("has no Search button", () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: /search/i })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StorefrontHeader.test.jsx --watchAll=false`
Expected: FAIL — About/Contact links not found; Search button still present.

- [ ] **Step 3: Update NAV_LINKS**

In `src/storefront/components/StorefrontHeader.jsx`, replace the `NAV_LINKS` array (lines 6–9) with:

```jsx
const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Shop", to: "/shop" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];
```

- [ ] **Step 4: Remove the no-op Search button and import**

Delete the Search `<button>` block (currently lines 76–81):

```jsx
            <button
              aria-label="Search"
              className="hidden sm:flex p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors cursor-pointer"
            >
              <Search size={20} />
            </button>
```

Then change the lucide import (line 3) from:

```jsx
import { ShoppingBag, Search, Menu, X } from "lucide-react";
```

to:

```jsx
import { ShoppingBag, Menu, X } from "lucide-react";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StorefrontHeader.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/storefront/components/StorefrontHeader.jsx src/storefront/__tests__/StorefrontHeader.test.jsx
git commit -m "Storefront brochure: header nav adds About/Contact, drops no-op Search"
```

---

## Task 7: Footer wiring

**Files:**
- Modify: `src/storefront/components/StorefrontFooter.jsx`
- Test: `src/storefront/__tests__/StorefrontFooter.test.jsx`

**Interfaces:**
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

```jsx
// src/storefront/__tests__/StorefrontFooter.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StorefrontFooter from "../components/StorefrontFooter";

function renderFooter() {
  render(
    <MemoryRouter>
      <StorefrontFooter />
    </MemoryRouter>
  );
}

describe("StorefrontFooter", () => {
  it("links to all four policy pages", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /shipping/i })).toHaveAttribute("href", "/policies/shipping");
    expect(screen.getByRole("link", { name: /returns/i })).toHaveAttribute("href", "/policies/returns");
    expect(screen.getByRole("link", { name: /privacy/i })).toHaveAttribute("href", "/policies/privacy");
    expect(screen.getByRole("link", { name: /terms/i })).toHaveAttribute("href", "/policies/terms");
  });

  it("links to About, Contact, and Size Guide", () => {
    renderFooter();
    expect(screen.getByRole("link", { name: /about/i })).toHaveAttribute("href", "/about");
    expect(screen.getByRole("link", { name: /contact/i })).toHaveAttribute("href", "/contact");
    expect(screen.getByRole("link", { name: /size guide/i })).toHaveAttribute("href", "/size-guide");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StorefrontFooter.test.jsx --watchAll=false`
Expected: FAIL — links not present.

- [ ] **Step 3: Expand the Help column and add a Policies column**

In `src/storefront/components/StorefrontFooter.jsx`, replace the existing **Help** column block (the `<div>` containing the `h4` "Help" and its `["Shop All","FAQ"]` list, currently lines 64–84) with the following two columns:

```jsx
          {/* Help */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Help
            </h4>
            <ul className="space-y-2.5 text-sm text-storefront-cream/70">
              {[
                { label: "Shop All", to: "/shop" },
                { label: "About", to: "/about" },
                { label: "Contact", to: "/contact" },
                { label: "FAQ", to: "/faq" },
                { label: "Size Guide", to: "/size-guide" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="hover:text-storefront-gold transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Policies */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Policies
            </h4>
            <ul className="space-y-2.5 text-sm text-storefront-cream/70">
              {[
                { label: "Shipping Policy", to: "/policies/shipping" },
                { label: "Returns & Exchange", to: "/policies/returns" },
                { label: "Privacy Policy", to: "/policies/privacy" },
                { label: "Terms of Service", to: "/policies/terms" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="hover:text-storefront-gold transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
```

Then update the footer grid container (line 10) to hold 5 columns at `lg`: change `lg:grid-cols-4` to `lg:grid-cols-5`.

Note on the test's `getByRole` "contact"/"returns"/"terms": these regex names are unique across the footer (the "Get in Touch" heading is not a link; "WhatsApp us" is the only other contact-ish link and won't match `/contact/i` on its accessible name "WhatsApp us"). If any `getByRole` throws a multiple-match error during the run, tighten that assertion to `getByRole("link", { name: "Returns & Exchange" })` etc. using the exact label.

- [ ] **Step 4: Run test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/StorefrontFooter.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/storefront/components/StorefrontFooter.jsx src/storefront/__tests__/StorefrontFooter.test.jsx
git commit -m "Storefront brochure: footer links to policies, About, Contact, Size Guide"
```

---

## Task 8: Home restructure

**Files:**
- Create: `src/storefront/components/home/BrandStory.jsx`
- Modify: `src/storefront/components/home/TrustBar.jsx`, `src/storefront/pages/HomePage.jsx`, `src/storefront/__tests__/TrustBar.test.jsx`
- Delete: `src/storefront/components/home/FeaturedCollection.jsx`, `src/storefront/components/home/BestsellerGrid.jsx`
- Test: `src/storefront/__tests__/BrandStory.test.jsx`, `src/storefront/__tests__/HomePage.test.jsx`

**Interfaces:**
- Consumes: existing `HeroBanner`, `CategoryShowcase`, `NewArrivals`, `TrustBar`.
- Produces: default export `BrandStory`.

- [ ] **Step 1: Confirm the two components are only imported by HomePage**

Run: `grep -rn "FeaturedCollection\|BestsellerGrid" src/ | grep -v "__tests__"`
Expected: matches ONLY in `src/storefront/pages/HomePage.jsx` (the imports/usages we will remove). If any other file imports them, STOP and report — do not delete.

- [ ] **Step 2: Write the failing BrandStory test**

```jsx
// src/storefront/__tests__/BrandStory.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import BrandStory from "../components/home/BrandStory";

describe("BrandStory", () => {
  it("renders a story blurb and a link to the About page", () => {
    render(
      <MemoryRouter>
        <BrandStory />
      </MemoryRouter>
    );
    expect(screen.getByRole("link", { name: /our story/i })).toHaveAttribute("href", "/about");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/BrandStory.test.jsx --watchAll=false`
Expected: FAIL — cannot find `../components/home/BrandStory`.

- [ ] **Step 4: Create BrandStory**

```jsx
// src/storefront/components/home/BrandStory.jsx
import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export default function BrandStory() {
  return (
    <section className="py-20 bg-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16 items-center">
        {/* Image */}
        <div className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-xs font-sans tracking-wide order-1 md:order-none">
          [Brand / store photo]
        </div>

        {/* Text */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px w-8 bg-storefront-gold" aria-hidden="true" />
            <span className="font-sans text-xs tracking-[0.3em] uppercase text-storefront-gold">
              Our Story
            </span>
          </div>
          <h2 className="font-display font-semibold text-storefront-charcoal text-[clamp(2rem,4vw,3rem)] leading-tight mb-4">
            Rooted in tradition,<br />crafted with love
          </h2>
          <p className="font-sans text-sm text-storefront-muted leading-relaxed max-w-md mb-8">
            A family-run ethnic-wear house in Ghaziabad, bringing handpicked
            sarees, lehengas, and suits to families who care about craft. Come
            visit us in person, or explore the collection online.
          </p>
          <Link
            to="/about"
            className="group inline-flex items-center gap-2 text-storefront-charcoal font-sans text-sm font-medium tracking-widest uppercase border-b border-storefront-charcoal/30 hover:border-storefront-gold hover:text-storefront-gold pb-1 transition-colors"
          >
            Our Story
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run BrandStory test to verify it passes**

Run: `CI=true npx react-scripts test src/storefront/__tests__/BrandStory.test.jsx --watchAll=false`
Expected: PASS.

- [ ] **Step 6: Slim TrustBar — drop Secure Checkout**

In `src/storefront/components/home/TrustBar.jsx`, change the import (line 2) from:

```jsx
import { Globe, ShieldCheck, RefreshCw, Lock } from "lucide-react";
```

to:

```jsx
import { Globe, ShieldCheck, RefreshCw } from "lucide-react";
```

Replace the `SIGNALS` array (lines 4–9) with (drop the `Lock`/Secure Checkout entry):

```jsx
const SIGNALS = [
  { icon: Globe, title: "Pan-India Shipping", desc: "Free on orders above ₹5,000" },
  { icon: ShieldCheck, title: "100% Authentic", desc: "Sourced directly from artisans" },
  { icon: RefreshCw, title: "7-Day Exchange", desc: "In-store exchange within 7 days" },
];
```

Change the grid (line 14) from `lg:grid-cols-4` to `lg:grid-cols-3`, and `grid-cols-2` to `sm:grid-cols-3` for balanced 3-up layout:

```jsx
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
```

- [ ] **Step 7: Update the TrustBar test for 3 signals**

Replace the contents of `src/storefront/__tests__/TrustBar.test.jsx` with:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import TrustBar from "../components/home/TrustBar";

describe("TrustBar", () => {
  it("advertises 7-day in-store exchange, not returns", () => {
    render(<TrustBar />);
    expect(screen.getByText(/7-Day Exchange/i)).toBeInTheDocument();
    expect(screen.getByText(/In-store exchange within 7 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/returns/i)).toBeNull();
  });

  it("does not claim Secure Checkout before checkout ships", () => {
    render(<TrustBar />);
    expect(screen.queryByText(/secure checkout/i)).toBeNull();
  });
});
```

- [ ] **Step 8: Write the failing HomePage test**

```jsx
// src/storefront/__tests__/HomePage.test.jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Stub the data-fetching sections so the test doesn't hit Supabase.
jest.mock("../components/home/HeroBanner", () => () => <div data-testid="hero" />);
jest.mock("../components/home/CategoryShowcase", () => () => <div data-testid="category" />);
jest.mock("../components/home/NewArrivals", () => () => <div data-testid="arrivals" />);

import HomePage from "../pages/HomePage";

describe("HomePage", () => {
  it("renders TrustBar and BrandStory, and no bestseller/featured grid", () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    );
    // TrustBar (real) present:
    expect(screen.getByText(/7-Day Exchange/i)).toBeInTheDocument();
    // BrandStory (real) present via its About link:
    expect(screen.getByRole("link", { name: /our story/i })).toHaveAttribute("href", "/about");
    // Removed grids' distinctive copy is gone:
    expect(screen.queryByText(/curated picks/i)).toBeNull();
    expect(screen.queryByText(/bridal edit/i)).toBeNull();
  });
});
```

- [ ] **Step 9: Run HomePage test to verify it fails**

Run: `CI=true npx react-scripts test src/storefront/__tests__/HomePage.test.jsx --watchAll=false`
Expected: FAIL — "Curated Picks"/"Bridal Edit" still render (grids not yet removed), or BrandStory link missing.

- [ ] **Step 10: Restructure HomePage**

Replace the entire contents of `src/storefront/pages/HomePage.jsx` with:

```jsx
import React from "react";
import HeroBanner from "../components/home/HeroBanner";
import TrustBar from "../components/home/TrustBar";
import CategoryShowcase from "../components/home/CategoryShowcase";
import NewArrivals from "../components/home/NewArrivals";
import BrandStory from "../components/home/BrandStory";
import Seo from "../components/Seo";

export default function HomePage() {
  return (
    <>
      <Seo description="Handcrafted sarees, lehengas, and ethnic wear from Bindal's Creations — rooted in tradition, crafted with love." />
      <HeroBanner />
      <TrustBar />
      <CategoryShowcase />
      <NewArrivals />
      <BrandStory />
    </>
  );
}
```

- [ ] **Step 11: Delete the two dead components**

```bash
git rm src/storefront/components/home/FeaturedCollection.jsx src/storefront/components/home/BestsellerGrid.jsx
```

- [ ] **Step 12: Run the full home-related test set to verify all pass**

Run: `CI=true npx react-scripts test src/storefront/__tests__/HomePage.test.jsx src/storefront/__tests__/BrandStory.test.jsx src/storefront/__tests__/TrustBar.test.jsx --watchAll=false`
Expected: PASS (all three).

- [ ] **Step 13: Verify build compiles (catches any lingering import of deleted files)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 14: Commit**

```bash
git add src/storefront/components/home/BrandStory.jsx src/storefront/components/home/TrustBar.jsx src/storefront/pages/HomePage.jsx src/storefront/__tests__/BrandStory.test.jsx src/storefront/__tests__/HomePage.test.jsx src/storefront/__tests__/TrustBar.test.jsx
git commit -m "Storefront brochure: restructure Home (slim TrustBar, BrandStory, drop featured/bestseller grids)"
```

---

## Final verification (after all tasks)

- [ ] **Run the full storefront test suite**

Run: `CI=true npx react-scripts test src/storefront --watchAll=false`
Expected: all storefront tests pass (including pre-existing CartDrawer, VariantPicker, Seo, etc.).

- [ ] **Production build**

Run: `npm run build`
Expected: succeeds with no unresolved imports or errors.

- [ ] **Manual smoke test**

Run `npm start`, then verify:
- Header shows Home / Shop / About / Contact; no Search icon.
- Every footer link resolves (no 404): `/about`, `/contact`, `/faq`, `/size-guide`, `/policies/shipping`, `/policies/returns`, `/policies/privacy`, `/policies/terms`.
- Home shows exactly: Hero, TrustBar (3 signals, no Secure Checkout), CategoryShowcase, NewArrivals, BrandStory.
- PDP shows a "Size guide" link that navigates to `/size-guide`.
- Contact page shows the Google map for the real address.
- Placeholder markers `[PLACEHOLDER — needs owner/legal review]` are visible on Privacy, Terms, About, and Size Guide content (so nothing fake ships to the gateway unreviewed).
