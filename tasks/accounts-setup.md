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

## 3. Delhivery One — shipping (start now; KYC ~1–3 days)

**Have ready:**
- GST number and certificate (or PAN + Aadhaar)
- Pickup address (the shop), contact person, phone
- Bank account for COD remittance (only needed if COD is enabled later)
- ₹500 for the minimum wallet recharge

**Steps:**
1. Go to https://one.delhivery.com → **Sign up** with the business phone/email.
2. Complete **KYC** with GSTIN (or PAN + Aadhaar).
3. Add the **pickup location**: the shop address, pincode 201001.
4. Recharge the wallet (minimum ₹500).
5. Book one **test shipment** (e.g. to a family address in UP) to learn the flow:
   create order → print label → pickup → tracking link.
6. Check the rate card for a 0.5 kg and a 1 kg parcel within Ghaziabad and to Lucknow,
   and send me those numbers. They decide whether the flat ₹99 shipping fee holds up.

**Send back:** the rates from step 6. For Phase C (automation) only: the API token, which goes
straight into Supabase secrets, never sent in chat.

*Alternative:* Shiprocket (https://app.shiprocket.in). Similar KYC (Aadhaar/GSTIN OTP + selfie),
more couriers, COD payout D+8. Only if you choose it over Delhivery.

---

## 4. Supabase secrets — only for Phase B (after Diwali)

Done by whoever sets up the website, not shared in chat:
1. Supabase dashboard → project → **Edge Functions → Secrets** (or `supabase secrets set`).
2. Add `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` (and `DELHIVERY_API_TOKEN` in Phase C).
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
- [ ] Delhivery One KYC done, test shipment sent, rates shared
- [ ] Terms / Privacy / Refund content finalised
- [ ] (Phase B) secrets added to Supabase and Vercel
