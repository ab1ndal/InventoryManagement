# Storefront Content Questions

Answer these before each component is finalized.
Leave blank if unknown — I'll use a placeholder and we'll fill in later.

---

## 1. Brand Identity

- [ ] What is the official tagline or brand line? (e.g. "Rooted in tradition, crafted with love")
- [ ] What is the official shop name to display? ("Bindal's Creations" or different spelling?) -> The official spelling is Bindal's Creation
- [ ] What city / area is the physical store in? -> Ghaziabad, Uttar Pradesh, India

---

## 2. Hero Banner

- [ ] What headline do you want? (currently placeholder: "Timeless Elegance, Modern Grace")
- [ ] What subtext / description? (1–2 sentences about the brand)
- [ ] Primary CTA button text and link? (currently: "Explore Collection" → /shop)
- [ ] Secondary CTA button text? (currently: "New Arrivals" → /shop)
- [ ] Do you have a lifestyle/hero image to use? Or keep the text-only dark background?
- [ ] What collection is currently active / seasonal? (e.g. "Summer 2025", "Festive Edit")

---

## 3. Announcement Bar (top strip)

- [ ] What is the free shipping threshold? (currently: ₹5,000 for India, $200 for International)
- [ ] Any other offer to show? (e.g. "10% off first order", "New arrivals every Friday") -> Right now, none but we can add more in future.

---

## 4. Category Showcase

These pull automatically from your `categories` table in Supabase.

- [ ] What categories are currently in the DB? (or should I query and list them?)
- [ ] Are there any categories you do NOT want to show on the storefront?
- [ ] Should categories link to a filtered shop page, or to separate category pages?

---

## 5. New Arrivals

Currently pulls the 10 most recently added products by product ID (BC25xxx).

- [ ] Is product ID order a good proxy for "newest"? Or do you want a different sort?
- [ ] How many products to show in this row? (currently: 10)
- [ ] Any products you want pinned / featured here specifically?

---

## 6. Featured Collection Block

- [ ] What collection to feature? (currently placeholder: "The Bridal Edit 2025")
- [ ] What headline? What short description (1–2 sentences)?
- [ ] The 3 stat numbers (currently made up: 500+ designs, 25+ years, 10k+ brides) — what are the real numbers?
- [ ] Should this link to a specific category or just /shop?

---

## 7. Bestsellers / Most Loved

Currently shows 6 highest-priced products.

- [ ] Is price a good proxy for "bestsellers"? Or do you want to hand-pick specific products?
- [ ] Section title: "Most Loved Pieces" — is that right? Or "Bestsellers", "Our Picks", etc.?

---

## 8. Trust Bar

Currently: Worldwide Shipping · 100% Authentic · Easy Returns · Secure Checkout

- [ ] Is worldwide shipping correct? Any regions excluded? -> We can facilitate that (in progress)
- [ ] What is the actual return window? (currently: "7-day returns") -> 7 day Exchanges, Returns only accepted in original quality -> Store credit issued for returns, Exchanges in Store only
- [ ] Any other trust signal to add or replace? We can add things about Transparent shipping updates (You can reach our service@bindalscreations.com)

---

## 9. Customer Reviews

Currently 3 made-up testimonials.

- [ ] Do you have real customer quotes/names to use?
- [ ] If yes: Name, location, and their quote for each (aim for 3–6 reviews)
- [ ] Star rating for each?

---

## 10. Newsletter Signup -> We will not do a Newsletter signup, we will do a whatsapp joining and also automate whatsapp posting

- [ ] Section title: "Join Our World" — keep or change?
- [ ] Any incentive for signing up? (e.g. "Get 10% off your first order")
- [ ] Where should signups go? (Email list provider? Or just collect in Supabase for now?)

---

## 11. Header Navigation

Currently: Home | Shop | About | Contact

- [ ] Any additional nav items? (e.g. "Collections", "Sale", "Lookbook")
- [ ] Should "Shop" have a dropdown by category?
- [ ] Phone number for header/footer?

---

## 12. Footer

- [ ] Real phone number? -> +91-9810873280
- [ ] Real email address? -> bindalscreations@gmail.com
- [ ] Instagram handle / URL? -> @bindals_creation_shop
- [ ] Facebook page URL? -> https://www.facebook.com/profile.php?id=61579168104897&mibextid=wwXIfr
- [ ] WhatsApp number for the FAB button? Same as Real Phone Number
- [ ] Physical store address to display? 58 Sihani Gate Market, Ghaziabad 201001
- [ ] Any footer links to add (size guide, privacy policy, terms)? Not yet, You can build it based on best practices for Indian Ethnic Wear.

---

## 13. Images (Critical)

`producturl` in DB contains Google Drive links — these don't work as `<img>` sources.

- [ ] Do you have product photos available to re-upload? I can reupload to any location
- [ ] Preferred hosting: **Supabase Storage** (free, already integrated) is recommended -> We will use Cloudinary + Youtube for videos
- [ ] If yes to Supabase Storage: I can set up the bucket and update the admin upload flow
- [ ] Approx. how many products currently have photos? Around 4000 unique products + variants

---

## 14. Checkout & Payments (Phase 4 — plan ahead)

- [ ] Do you want to accept orders from India only, or worldwide? I will accept orders worldwide. It will only be feasible once we have US based integration.
- [ ] Preferred payment gateway: Razorpay (India), Stripe (international), or both? I will do both and show prices based on location. Eg. Rs in India, $ in US
- [ ] Do you have a Razorpay / Stripe account already? Not yet, I will need helping set it up. Also give me guidance on how to handle regional tax compliances (if needed)
- [ ] Who handles shipping / fulfilment? Manual or courier integration? We haven't decided yet, we will have to do courier integration at some point.

---

## 15. Domain

- [ ] Is www.bindalscreations.com already pointing to this app, or still in progress? It is pointing to this app. If needed, provide me guidance on creation of subdomains to keep things organized.
