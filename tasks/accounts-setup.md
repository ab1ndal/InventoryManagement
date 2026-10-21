# Accounts to set up for checkout & shipping

Written 2026-10-13 for the owner. Do these in order. Each section lists what to have ready,
the steps, and what to send back so the website can be connected.
Plan: `tasks/checkout-shipping-plan.md`.

**Never paste secret keys into WhatsApp, email or chat.** Where a secret is needed, it goes
straight into Supabase secrets (step 4), which only the person doing the setup touches.

---

## 1. Chartered Accountant — confirm before selling online (this week)

Ask your CA these questions (copy and send):

> We are registered under the GST composition scheme (we issue Bills of Supply) in Uttar Pradesh.
> We want to sell through our own website with online payment.
> 1. Can we sell to customers in Uttar Pradesh through our own website (not Amazon/Flipkart)
>    while staying in the composition scheme?
> 2. We understand we cannot ship to customers outside UP (s.10(2)(c)). Please confirm.
> 3. If a customer in UP asks for delivery to an address outside UP, is that an inter-state supply?
> 4. Is a Bill of Supply still correct for these online sales, and does anything change for
>    payment gateway or courier records?
> 5. Do we need to show anything specific on the website (GSTIN, "composition taxable person" text)?

**Send back:** the CA's answers, which decide whether Phase A can go live.

---

## 2. Razorpay — payments (start now; KYC takes a few days)

**Have ready:**
- PAN of the proprietor
- GST certificate (composition is fine; it's used as business proof)
- Business bank account details (account in the proprietor's or firm's name) and a cancelled cheque
- Aadhaar of the proprietor (for verification)
- Website: https://www.bindalscreations.com
- Business address (58, Sihani Gate Market, Ghaziabad 201001), phone, email

**Steps:**
1. Go to https://razorpay.com → **Sign Up**. Use the business email and phone.
2. Choose business type **Proprietorship**, and category **Fashion / Apparel**.
3. Complete **KYC / Activation** in the dashboard: upload PAN, GST certificate, bank details.
4. For **Website details**, enter the website URL. Razorpay checks that these pages exist and
   are real (not placeholder): Contact Us (with address), Terms, Privacy, Cancellation & Refund,
   Shipping, and visible product prices. The site has these pages, but **Terms and Privacy are
   still placeholders**. Tell me before you submit and I'll replace them first.
5. While activation is pending, you can test in **Test Mode**.
6. After activation, use **Payment Links** (Dashboard → Payment Links → Create) for Diwali
   orders. No website code is needed for this.

**Send back (later, for Phase B):**
- The **Key ID**, which starts with `rzp_live_` (this one is public and safe to share).
- **Do not send the Key Secret or Webhook Secret.** They are added straight into Supabase in step 4.

**Fees (as published Oct 2026):** 2% + 18% GST on UPI, domestic cards and netbanking. No setup or annual fee. Settlement T+1.

---

## 3. Shiprocket — shipping (owner decision 2026-10-20; KYC instant to ~3 days)

Everything in the **shop's** name (BINDAL'S CREATION, GSTIN 09ABVPB4203A1Z4). Prepaid only, UP only.

**Have ready:**
- Phone that receives the OTP for the GST-registered mobile number (for instant GSTIN KYC)
- PAN and GST certificate (fallback if instant KYC fails; names must match exactly)
- Pickup/RTO contact person and phone (gets an OTP to confirm the pickup address)
- ₹500 for the minimum wallet recharge
- A **second email address** for the API user (must differ from the main login email)

**Steps:**
1. Sign up at https://app.shiprocket.in with the business phone and email. Stay on the free
   **Lite** plan for now (higher plans only lower rates; worth it above ~100 shipments/month).
2. **KYC:** take the selfie, then verify with **GSTIN** (OTP to the GST mobile). If that fails,
   upload PAN + GST certificate (manual review 1–3 working days).
3. **Pickup address:** Settings → Pickup Addresses → Add. Shop address, pincode 201001.
   Name it exactly `Shop` (the API refers to it by this name). Confirm with the OTP.
4. Recharge the wallet with ₹500.
5. **Rates:** open the rate calculator, pickup 201001, prepaid, and note the cheapest rate +
   delivery days for:
   - 0.5 kg and 1 kg and 2 kg to a Ghaziabad pincode (e.g. 201002)
   - the same weights to Lucknow (226001) and Varanasi (221001)
   These decide whether the flat ₹99 fee below ₹5,000 holds up.
6. **One test parcel** to a family address in UP: create order → pick courier → label →
   pickup → watch tracking. Learns the flow used for Diwali orders.
7. **API user** (for the website integration): Settings → API → **Create API User**, using the
   second email. Grant only Orders, Shipments/Courier, Tracking and Pincode modules. The password
   is shown **once**: put it straight into Supabase secrets (section 4) yourself, or into a
   password manager to hand over in person. **Never send it in chat or email.**

**Send back:** the rate table from step 5, and confirm steps 2, 3 and 7 are done.

---

## 4. Supabase secrets — when the website integration starts

Done by whoever sets up the website, not shared in chat:
1. Supabase dashboard → project → **Edge Functions → Secrets** (or `supabase secrets set`).
2. Add `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, and for shipping
   `SHIPROCKET_API_EMAIL` and `SHIPROCKET_API_PASSWORD` (the API user from section 3, step 7).
3. In Vercel → project → Settings → Environment Variables, add `REACT_APP_RAZORPAY_KEY_ID`
   (public key only).

---

## 5. Website content you need to provide

- [ ] Real **Terms** and **Privacy** text (or approve drafts I write from Razorpay's templates).
- [ ] Refund/cancellation rules for **online** orders. Today it's "no returns, in-store exchange
      within 7 days". Decide whether online buyers can exchange by courier, and who pays shipping.
- [ ] Confirm the shipping policy wording: UP only, ₹99 below ₹5,000, free above, dispatch in
      2 days, delivery in 5–7 days.
- [ ] Business email to show on the Contact page (gateways check it).

## Checklist
- [ ] CA answers received
- [ ] Razorpay account activated (Key ID shared)
- [ ] Shiprocket KYC done, pickup address `Shop` verified, test parcel sent, rates shared
- [ ] Shiprocket API user created, credentials in Supabase secrets
- [ ] Terms / Privacy / Refund content finalised
- [ ] (Phase B) secrets added to Supabase and Vercel
