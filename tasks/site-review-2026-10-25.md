# Site review 2026-10-25 (taste-skill pass + Codex adversarial review)

Goal (owner): the site must not look or read AI-made; /customize is the main differentiator.

## Triage
- Done (commit b60d912 and earlier): 1 contact placeholders, 3 WhatsApp opener, 4 price wording, 5 alterations wording, 6 fine-print heading, 10 About claims, 12 home tailoring band, 13 brand story + SEO, 18 hero sublines, 20 footer tel/mailto, footer split.
- Needs owner content: 2 real before/after custom pieces on /customize, 9 real shop/tailor photo for About (replace CC stock), contact photos.
- Needs owner decision: 7 product names on cards (owner removed titles 2026-10-20), 17 "Diwali Glam" naming (owner's), 21 sentence-case page titles, "Handpicked with love" repeated 3x (owner slogan, pinned by tests), Inter body font.
- Build later: 8 PDP mobile sticky bar + beige disabled-looking button, 11 fewer home rails, 14 trust bar strip, 15 collections index redesign, 16 nav taxonomy, 19 mobile footer accordions; More-like-this shows men's suits under women's 3-pc suits (Suit (3 Pc) category mixes both).

## Codex review (verbatim)

I found 21 material issues. The site is functional, but it currently feels like a polished catalogue assembled from familiar ecommerce components—not yet like a trusted Ghaziabad shop with a genuinely unusual tailoring service.

## P0 — hurting trust or conversion now

1. **Contact: visible photo placeholders make the business look unfinished**

   - **Where:** [ContactPage.jsx:69](src/storefront/pages/ContactPage.jsx:69)
   - **Problem:** Customers literally see “[Storefront photo]” and “[Interior photo]”.
   - **Why it hurts:** These are the two photographs that could prove Bindal’s is a real local shop. Placeholders on the trust page do the opposite.
   - **Fix:** Replace them with ordinary phone photographs of the entrance, counter, racks and staff. Authenticity matters more than professional lighting. Until those exist, remove the boxes entirely.

2. **Customize: no evidence that Bindal’s has made anything from a reference photo**

   - **Where:** [CustomizePage.jsx:39](src/storefront/pages/CustomizePage.jsx:39)
   - **Problem:** The page promises “we make the one in your photo” but shows only a generic styled worktable image.
   - **Why it hurts:** This is a high-trust, high-consideration purchase. A staged mood image cannot substantiate the central claim.
   - **Fix:** The hero should show a real two-part example: “Photo customer sent” beside “What we made,” followed by 2–4 more completed orders. Add honest captions such as “Customer reference” and “Made by our tailors in Ghaziabad.” Obtain customer permission and obscure faces if necessary.

3. **Customize: the WhatsApp form asks for too much before establishing a conversation**

   - **Where:** [customizeContent.js:13](src/storefront/pages/customizeContent.js:13)
   - **Problem:** Clicking the main CTA opens a seven-field template asking for garment, budget, quantity, size, fabric and deadline.
   - **Why it hurts:** The page says “send the photo,” but the actual interaction feels like homework. Many Instagram-led shoppers will not know the fabric or final size.
   - **Fix:** Use:
     > Hi Bindal’s Creation, I’d like an outfit made from this reference. I’m attaching the photo. Please tell me what is possible and the approximate price.

     Collect size, fabric and deadline after the shop responds.

4. **Customize: the price claim may attract the wrong leads and undermine credibility**

   - **Where:** [customizeContent.js:43](src/storefront/pages/customizeContent.js:43)
   - **Problem:** “From ₹3,000” appears as a universal minimum beside lehengas, sherwanis and formal suits.
   - **Why it hurts:** It implies that elaborate film-star outfits may be made for ₹3,000. Either shoppers expect an impossible price or assume the offer is bait.
   - **Fix:** Make the distinction explicit:
     > Stitching starts at ₹3,000  
     > Final price depends on fabric and handwork

     Better still, provide credible starting ranges by garment after verifying them with the owner.

5. **Customize: “Free alterations” is broader than the actual restriction**

   - **Where:** [customizeContent.js:47](src/storefront/pages/customizeContent.js:47), [customizeContent.js:55](src/storefront/pages/customizeContent.js:55)
   - **Problem:** The prominent fact says “Free — Alterations at the shop”; the limitation that delivered pieces must be brought back is buried in an accordion.
   - **Why it hurts:** This can feel like a changed promise after purchase.
   - **Fix:** Replace the fact with:
     > Free fitting corrections  
     > At our Ghaziabad shop

6. **Customize: the risk-heavy accordion title appears before enough reassurance**

   - **Where:** [CustomizePage.jsx:125](src/storefront/pages/CustomizePage.jsx:125)
   - **Problem:** “Before you order: prices, delivery and refunds” sounds like legal fine print and foregrounds refund anxiety.
   - **Why it hurts:** It makes the offer feel restrictive before shoppers have seen proof, fabrics, fit or the people doing the work.
   - **Fix:** Rename it “A few things to know” and place it after real examples and customer reassurance. Break out one friendly line above it:
     > We confirm the fabric, price and ready date with you before you pay.

7. **Shop and collection cards omit product names**

   - **Where:** [ProductCard.jsx:9](src/storefront/components/ProductCard.jsx:9), [ProductCard.jsx:201](src/storefront/components/ProductCard.jsx:201)
   - **Problem:** Cards show only price and fabric. A shopper sees “₹995 / Cotton,” not whether the item is a kurti, suit, cord set or kurta-pajama.
   - **Why it hurts:** It resembles an image dump or wholesale inventory system, particularly when the shop page mixes men’s suits, nightwear, T-shirts and ethnic wear.
   - **Fix:** Add a plain product name above the price, e.g. “Black embroidered 3-piece suit.” If database names are mechanical, derive and curate customer-facing names instead of hiding them.

8. **PDP: the primary purchase control is disabled-looking and unexplained**

   - **Where:** [ProductDetailPage.jsx:253](src/storefront/pages/ProductDetailPage.jsx:253)
   - **Problem:** Desktop says “Select size & colour”; mobile also presents a sticky “Select size” bar while the full selector remains immediately below it.
   - **Why it hurts:** The duplicated controls compete, and the beige primary button resembles a disabled state.
   - **Fix:** On mobile, keep only one persistent action. Initially label it “Choose size and colour”; after selection change it to “Add to bag · ₹995”. Use a strong filled brand colour only when actionable.

9. **About: a licensed stock craft photograph weakens the family-shop claim**

   - **Where:** [AboutPage.jsx:39](src/storefront/pages/AboutPage.jsx:39)
   - **Problem:** The only visible craftsmanship image is credited stock photography from Hyderabad.
   - **Why it hurts:** Customers are being told about Bindal’s own selection and tailoring while shown someone else’s work. The tiny attribution makes the page feel assembled rather than personal.
   - **Fix:** Replace it with a phone photograph of the owner selecting stock, a tailor working, fabric shelves or an alteration in progress. Add a factual caption with a name and place.

10. **About: unsupported absolutes could backfire**

   - **Where:** [aboutContent.js:10](src/storefront/pages/aboutContent.js:10), [aboutContent.js:20](src/storefront/pages/aboutContent.js:20)
   - **Problem:** “Every piece … chosen ourselves” and “never bought in bulk” are strong, repeated claims.
   - **Why it hurts:** The catalogue contains many generic, similarly photographed items. If any stock is bought in quantity, the copy becomes an easily disproven trust claim.
   - **Fix:** Use defensible wording:
     > We choose the styles we stock instead of listing an endless supplier catalogue.

     And:
     > Selected by our family for fabric, finish and value.

## P1 — substantial brand and usability problems

11. **Home: almost the entire page is repetitive product rails**

   - **Where:** [HomePage.jsx:13](src/storefront/pages/HomePage.jsx:13), [HomePage.jsx:29](src/storefront/pages/HomePage.jsx:29)
   - **Problem:** Diwali, New Arrivals, Sarees, Lehengas, Kurtis, Everyday, Sherwani and Kurta Pajama all use the same horizontal-card module.
   - **Why it reads generic:** It is the standard generated storefront rhythm: heading, “View all,” cards, repeat.
   - **Fix:** Reduce this to three merchandising moments: “New in the shop,” a large visual custom-tailoring story and one occasion-led edit. Put the rest behind navigation.

12. **Home: the key differentiator is buried in a rotating carousel**

   - **Where:** [heroSlides.js:23](src/storefront/lib/heroSlides.js:23)
   - **Problem:** Customize is slide two and can disappear automatically.
   - **Why it hurts:** The owner’s main offering should not depend on whether a shopper waits four seconds.
   - **Fix:** Give custom tailoring a permanent homepage section immediately below the first hero, with a real before/after example and “Send us the look on WhatsApp.”

13. **Home metadata and brand copy contain exactly the requested AI tells**

   - **Where:** [HomePage.jsx:25](src/storefront/pages/HomePage.jsx:25), [BrandStory.jsx:29](src/storefront/components/home/BrandStory.jsx:29)
   - **Problem:** “Rooted in tradition,” “handpicked with love,” “curated with care,” and the em-dash construction are generic luxury-copy fillers.
   - **Fix:** Replace the visible block with:
     > A family-run clothing shop in Sihani Gate  
     > We have helped Ghaziabad families find sarees, lehengas, suits and wedding wear since 2018. Visit the shop, or send us a reference on WhatsApp if you want something made.

     SEO description:
     > Shop sarees, lehengas, suits, kurtis and men’s wedding wear from Bindal’s Creation in Ghaziabad. Store pickup and delivery within Uttar Pradesh.

14. **Home trust bar is the stereotypical icon–title–blurb row**

   - **Where:** [TrustBar.jsx:9](src/storefront/components/home/TrustBar.jsx:9)
   - **Problem:** Five Lucide icons repeat claims already present elsewhere.
   - **Why it reads AI/template-made:** “Heart + handpicked,” “refresh + exchange” and “truck + shipping” are default ecommerce-kit semantics.
   - **Fix:** Replace it with one compact factual strip:
     > Ghaziabad shop since 2018 · Call or WhatsApp +91 98108 73280 · Sizes up to 6XL · In-store exchanges within 7 days

15. **Collections index is an empty generic card matrix**

   - **Where:** [CollectionsIndexPage.jsx:11](src/storefront/pages/CollectionsIndexPage.jsx:11)
   - **Problem:** Eleven equal white bordered cards, all centered, with interchangeable one-line blurbs.
   - **Why it reads AI/template-made:** This is the exact “equal card grid + centered everything” pattern the brief warns against.
   - **Fix:** Make the page visual and hierarchical: large Sarees, Lehengas, Men and Custom Tailoring tiles with actual merchandise; put Everyday, Plus Size and seasonal edits in a smaller secondary list. “Custom Tailoring” currently is not even represented here.

16. **The collections taxonomy mixes product type, audience, use and size**

   - **Where:** [collections.js:33](src/storefront/lib/collections.js:33)
   - **Problem:** “Sarees,” “Men,” “Everyday,” “Sherwani,” “Diwali Glam” and “Plus Size” appear as equivalent collection choices.
   - **Why it hurts:** Shoppers cannot predict whether “Sherwani” is inside “Men,” whether “Everyday” repeats Kurtis, or why size is treated like a category.
   - **Fix:** Structure navigation as:

     - Women: Sarees, Lehengas, Suits, Kurtis, Gowns
     - Men: Sherwanis, Kurta Pajamas, Suits
     - Shop by need: Plus sizes, Everyday, Diwali
     - Made for you: Custom tailoring

17. **“Diwali Glam” sounds like campaign-generator copy**

   - **Where:** [heroSlides.js:17](src/storefront/lib/heroSlides.js:17), [collections.js:25](src/storefront/lib/collections.js:25)
   - **Problem:** “Glam,” “Discover the glam” and “season of lights” stack three campaign clichés.
   - **Fix:** Use:
     > Diwali collection  
     > Sarees, lehengas, suits and sherwanis chosen for pujas, parties and family functions.  
     > Shop the collection

18. **Hero copy retains “curated” and vague fashion language**

   - **Where:** [heroSlides.js:35](src/storefront/lib/heroSlides.js:35), [heroSlides.js:43](src/storefront/lib/heroSlides.js:43)
   - **Problem:** “Rich weaves … curated with care” and “Statement silhouettes, handpicked with love.”
   - **Why it reads AI-written:** Abstract adjective+noun pairings say nothing about actual products.
   - **Fix:** Sarees:
     > Silk, georgette and everyday sarees from ₹1,995.

     Lehengas:
     > Bridal, festive and lighter lehengas for smaller functions.

19. **Footer overwhelms nearly every mobile page**

   - **Where:** [StorefrontFooter.jsx:17](src/storefront/components/StorefrontFooter.jsx:17)
   - **Problem:** On mobile it becomes five long stacked columns and occupies roughly half the About, Contact, FAQ and Size Guide screenshots.
   - **Why it hurts:** Pages feel shorter, more templated and harder to scan; navigation is repeated rather than prioritized.
   - **Fix:** On mobile show the logo, phone/WhatsApp, address and four primary links. Put Shop, Help and Policies into three compact accordions. Remove the fake card-brand badges unless those methods are verified and recognizable via proper assets.

20. **Footer contact details are not all actionable**

   - **Where:** [StorefrontFooter.jsx:134](src/storefront/components/StorefrontFooter.jsx:134)
   - **Problem:** The phone number and email are plain spans while WhatsApp is a link.
   - **Why it hurts:** Mobile users reasonably expect tap-to-call and tap-to-email.
   - **Fix:** Wrap them with `tel:+919810873280` and `mailto:bindalscreations@gmail.com`. Add “Open 10 AM–8:30 PM · Closed Tuesday” beside the address.

## P2 — polish, consistency and secondary usability

21. **Title case and over-formal page labels distance the shop from customers**

   - **Where:** [aboutContent.js:7](src/storefront/pages/aboutContent.js:7), [ContactPage.jsx:16](src/storefront/pages/ContactPage.jsx:16), [FaqPage.jsx:24](src/storefront/pages/FaqPage.jsx:24), [SizeGuidePage.jsx:13](src/storefront/pages/SizeGuidePage.jsx:13)
   - **Problem:** “Our Story,” “Visit Us,” “Frequently Asked Questions” and “Size Guide” use portfolio-style title case.
   - **Fix:** Use conversational sentence case:

     - “About Bindal’s”
     - “Visit our Ghaziabad shop”
     - “Questions customers ask”
     - “Find your size”

## The five changes with the greatest impact

1. Put real shop, family, tailor and completed-custom-order photographs throughout Contact, About and Customize.
2. Turn Customize into a proof-led before/reference-after/result page, with the WhatsApp CTA immediately beside that evidence.
3. Simplify the WhatsApp starter message to one low-friction request: attach the photo and ask what is possible.
4. Restore clear customer-facing product names on every product card and simplify the PDP’s mobile purchase action.
5. Cut the repetitive homepage rails and oversized mobile footer; use that space to make custom tailoring a permanent, unmistakable part of the brand.
