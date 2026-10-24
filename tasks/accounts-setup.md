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

## 2. Cashfree — payments (signup started 2026-10-23; activation usually within a working day)

Chosen over Razorpay 2026-10-23 for the festive 0% offer; reasons in
`tasks/checkout-shipping-plan.md` "Gateway decision".

**Have ready:**
- PAN of the proprietor (Pooja Bindal; a sole proprietor uses the personal PAN)
- Aadhaar linked to a phone that can receive the OTP (owner identity check)
- Bank account in the proprietor's name: account number + IFSC
- GST certificate (GSTIN 09ABVPB4203A1Z4) as business proof
- Website: https://www.bindalscreations.com
- Business email bindalscreations@gmail.com, phone, shop address

**Steps:**
1. Open https://merchant.cashfree.com/merchants/signup **directly**. A partner or referral link
   loses the 0% offer.
2. Sign up with the business email and a new password (keep it in a password manager), then
   enter the email and phone OTPs.
3. Business type **Sole Proprietorship**, category **Fashion / Apparel**.
4. KYC in the dashboard: PAN, Aadhaar OTP (or DigiLocker), bank account, GST certificate.
5. **Website details:** submit the URL only after `feat/cashfree-readiness` is live. Cashfree
   checks for real Terms, Privacy, About, Contact, refund/cancellation and shipping pages, and
   can deactivate an account whose site later stops complying.
6. While activation is pending, use the **Test** environment.
7. After activation, use **Payment Links** in the dashboard for Diwali orders. No website code needed.

**Send back (later, for Phase B):** confirm activation. **Never send the Client ID or Client
Secret in chat or email.** They go straight into Supabase secrets (section 4).

**Fees (official page, 23 Oct 2026):** 0% platform fee on the first ₹20 lakh GMV until
31 Mar 2027 (18% GST still charged on the notional 1.95%), then 1.95% + GST. No setup fee.
T+1 settlement. Payment Links included.

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
2. Add `CASHFREE_CLIENT_ID` and `CASHFREE_CLIENT_SECRET` (the secret also verifies webhook
   signatures; confirm against Cashfree's docs when Phase B starts), and for shipping
   `SHIPROCKET_API_EMAIL` and `SHIPROCKET_API_PASSWORD` (the API user from section 3, step 7).
3. No Cashfree key goes in Vercel: the browser checkout only needs the payment session id
   that `create-order` returns.

---

## 5. Website content you need to provide

- [x] Real **Terms** and **Privacy** text (or approve drafts). Done 2026-10-23.
- [x] Refund/cancellation rules for **online** orders (2026-10-23: cancel before dispatch = full refund in 5–7 working days; damaged/wrong item within 48h of delivery = replacement or refund). Today it's "no returns, in-store exchange
      within 7 days". Decide whether online buyers can exchange by courier, and who pays shipping.
- [ ] Confirm the shipping policy wording: UP only, ₹99 below ₹5,000, free above, dispatch in
      2 days, delivery in 5–7 days.
- [ ] Business email to show on the Contact page (gateways check it).

## Checklist
- [ ] CA answers received
- [ ] Cashfree account activated
- [ ] Shiprocket KYC done, pickup address `Shop` verified, test parcel sent, rates shared
- [ ] Shiprocket API user created, credentials in Supabase secrets
- [x] Terms / Privacy / Refund content finalised (2026-10-23)
- [ ] (Phase B) secrets added to Supabase and Vercel
