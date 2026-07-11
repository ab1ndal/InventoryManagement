# Storefront — Status Review & Store-Owner Questions

**Date:** 2026-07-11
**Purpose:** Snapshot of what's live vs pending on the public storefront, plus the decisions and setup that only the store owner can provide. Review each section, fill in / tick the answers, and approve. Nothing below is blocking day-to-day operations — this gates the *public launch* and the payment/shipping build.

---

## 1. Status at a glance

| Area | State |
|---|---|
| Security prerequisites (Phase 0) | ✅ Done |
| Brochure site: Home, About, Contact, FAQ, Size guide, 404, 4 policy pages | ✅ Built — **copy is placeholder, needs your real content** |
| Trust: WhatsApp button, legitimacy footer, SEO, sitemap | ✅ Done |
| Shop: filters, sort, result count, skeletons | ✅ Done |
| Product page: images, specs (fabric/care), delivery estimate, low-stock | ✅ Done |
| Product images pipeline (Vercel optimization) | ✅ Done (needs Vercel Pro — see §4) |
| Search (command palette) | ✅ Done |
| **Cart page + customer login (email link) + saved cart** | ✅ Done (shipped 2026-07-11) |
| Checkout + payment (Razorpay/COD) | ⏸️ Deferred — placeholder page planned, no real payment yet |
| Shipping + order tracking (Shiprocket) | ⏸️ Deferred — placeholder page planned |
| Growth: wishlist, collections, analytics, verified reviews | ⏳ Not started (Phase 4) |

---

## 2. Questions we need you to answer

> Tick the box or write your answer on the line. Our recommendation is noted where we have one.

### A. Content to provide (needed before public launch / gateway application)
These pages are live but filled with placeholder text. Please supply the real content:

- [ ] **Brand story** — family history, city, since-when (for About page). → _____________________
- [ ] **Hero photo** — one real, seasonal campaign image for the homepage. → _____________________
- [ ] **Store photos** — exterior + interior of the physical shop (for Contact page). → _____________________
- [ ] **FAQ answers** — the real questions customers ask on WhatsApp / in person. → _____________________
- [ ] **Size / measurement guidance** — real measurement content for the Size guide. → _____________________

### B. Business facts to confirm (shown publicly + used for payment-gateway application)
- [ ] Registered business name: currently shown as **"Bindal's Creation"** — correct? → _____________________
- [ ] Address: currently **"58 Sihani Gate Market, Ghaziabad 201001"** — correct? → _____________________
- [ ] **GSTIN:** currently **`09ABVPB4203A1Z4`** — is this real and final? → _____________________
- [ ] Phone: currently **+91 98108 73280** (also the WhatsApp number) — correct? → _____________________
- [ ] Email: currently **bindalscreations@gmail.com** — correct? → _____________________

### C. Policy decisions (must match what the pages claim + what the gateway requires)
- [ ] **Returns window** — the site claims **7-day returns**. Is that your real policy? If not, what is it? → _____________________
- [ ] **Shipping charges** — recommendation: flat rate (₹99–149) + free above ₹5,000, India-only. Confirm or change. → _____________________
- [ ] **Cash on Delivery (COD)** — offer it at launch? Recommendation: **yes, with a cap (e.g. ≤₹10,000)**. → _____________________
- [ ] **Serviceable regions** — all-India, or exclude some pincodes? → _____________________

### D. Accounts / services to arrange (long lead — start early even though the build is deferred)
- [ ] **Razorpay merchant account** — do you already have one, or is this a fresh application? (Approval takes days and is the biggest delay for going live with payments.) → _____________________
- [ ] **Shiprocket account** (shipping aggregator) — existing or new? → _____________________

---

## 3. Items flagged for review (mostly informational)

- **Placeholder page copy** — see §2.A. Until replaced, do not file the payment-gateway application (the gateway checks these pages).
- **Identity edge cases** — when a customer signs in and their details are ambiguous (e.g. two in-store records share an email, or a typed phone matches a protected record with store credit), the system does **not** guess — it saves a dated note on the customer record for a human to review and merge. There is **no admin screen for this yet**; we recommend building a small "review flagged customers" screen (we can include it with the admin orders work). Until then those notes sit on the customer record unseen.
- **Minor known code items** (non-blocking, logged for transparency): a rare cart-quantity sync edge case on rapid repeated taps; a duplicate toast when an item is both re-priced and stock-capped at once; abandoned placeholder customer rows after an identity merge (harmless, worth a periodic cleanup). None affect correctness of orders or money.

---

## 4. Things you need to set up (technical, but your call/account)

- [ ] **Custom email sending (SMTP) in Supabase** — **required before real customer logins.** The built-in email is rate-limited and rejects some addresses, so magic-link sign-in emails won't reliably arrive without this. (We configure it; you decide the sending address / provider.)
- [ ] **Vercel Pro plan (~$20/month)** — the hosting free tier is for non-commercial use only; a real store needs Pro. The product-image optimization already assumes this.

---

## 5. What happens after you approve

1. **Phase 4 (growth, no payment needed):** wishlist, full search results page, curated collection pages, basic analytics. (We'll confirm which of these you want.)
2. **Placeholder Checkout & Shipping pages:** we'll build the *front-end* of the checkout and order-tracking flow so the journey feels complete and you can see it — **without** connecting Razorpay or Shiprocket. Real payment/shipping wiring stays deferred until the accounts above are ready and you say go.

---

### Approval

- [ ] I've reviewed and answered the questions above.
- [ ] Proceed with Phase 4 + placeholder Checkout/Shipping pages.

_Notes:_ _______________________________________________
