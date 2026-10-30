import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FreeShippingNudge from "./FreeShippingNudge";
import CheckoutSummary from "./CheckoutSummary";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";
import { formatSize } from "../lib/sizes";
import {
  quote,
  createOrder,
  createOrderMessage,
  fetchMyCustomer,
  formatRupees,
  loadCashfree,
  newAttemptKey,
} from "../lib/ordersApi";
import { rememberPendingOrder } from "../lib/pendingOrder";
import { guestHolderKey } from "../lib/holder";
import { INDIAN_STATES, UP_STATE } from "../lib/checkout";

const QUOTE_DEBOUNCE_MS = 300;
const PINCODE = /^\d{6}$/;

const OUTSIDE_UP_NOTE =
  "We usually deliver within Uttar Pradesh. For other states we'll confirm delivery with you on WhatsApp before dispatch.";

const CODE_MESSAGES = {
  ok: "Code applied",
  invalid: "That code isn't valid",
  rate_limited: "Too many attempts, try later",
};

function toAddress(values) {
  const address = { name: values.name.trim(), phone: values.phone.trim() };
  if (values.email?.trim()) address.email = values.email.trim();
  if (values.fulfilment === "pickup") return address;
  address.line1 = values.line1.trim();
  address.city = values.city.trim();
  address.state = values.state;
  address.pincode = values.pincode.trim();
  if (values.line2?.trim()) address.line2 = values.line2.trim();
  if (values.landmark?.trim()) address.landmark = values.landmark.trim();
  return address;
}

// Fills City and State from the quote's pincode lookup (Shiprocket, server
// side) once per pincode. A field is filled only while empty or still holding
// the previous autofill, so whatever the shopper typed is never overwritten.
// Returns the looked-up place (state mapped to our list, else null).
function autofillFromPincode(pincode, lookup, last, getValues, setValue) {
  // The State select only takes our listed names; an unknown spelling is left for the shopper.
  const stateName = typeof lookup.state === "string" ? lookup.state.trim().toLowerCase() : "";
  const place = { pincode, city: lookup.city || null, state: INDIAN_STATES.find((s) => s.toLowerCase() === stateName) || null };
  if (last.pincode === pincode) return place;
  last.pincode = pincode;
  const fill = (field, value) => {
    if (!value) return;
    const current = getValues(field) || "";
    if (current && current !== last[field]) return;
    last[field] = value;
    if (current !== value) setValue(field, value, { shouldValidate: true });
  };
  fill("city", place.city);
  fill("state", place.state);
  return place;
}

function unavailableText(entry, items) {
  const item = items.find((i) => i.variant_id === entry.variantId);
  const label = item ? `${item.name} (${formatSize(item.size)}/${item.color})` : "An item";
  return entry.available > 0
    ? `Only ${entry.available} left of ${label}. Please reduce the quantity in your cart.`
    : `${label} isn't available right now (sold out, or in someone else's cart). Remove it, or try again in a few minutes.`;
}

// Online checkout (checkout_live = true): every total comes from the
// checkout-quote function; create-order re-prices on the server again.
export default function LiveCheckout({ items, form, onCheckoutOff, onPincodePlace }) {
  const { user } = useStorefrontAuth();
  const navigate = useNavigate();
  const { watch, setValue, getValues, handleSubmit, formState } = form;

  // One key per checkout visit, reused on retries, so a double click or a
  // retry after a timeout never creates two orders (plan R6).
  const [attemptKey] = useState(newAttemptKey);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeNotice, setCodeNotice] = useState(null);
  const [creditInput, setCreditInput] = useState("");
  const [response, setResponse] = useState(null);
  const [quoteError, setQuoteError] = useState(false);
  const [quoting, setQuoting] = useState(true);
  const [requoteTick, setRequoteTick] = useState(0);
  const [notice, setNotice] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const autofilled = useRef({ pincode: "", city: "", state: "" });

  const fulfilment = watch("fulfilment");
  const pickup = fulfilment === "pickup";
  const pincodeValue = watch("pincode") || "";
  // A pickup quote needs no pincode, so typing one must not trigger re-quotes.
  const pincode = !pickup && PINCODE.test(pincodeValue.trim()) ? pincodeValue.trim() : "";
  const lineItems = useMemo(
    () => items.map((i) => ({ variantId: i.variant_id, qty: i.quantity })),
    [items]
  );
  const creditAvailable = user ? Number(response?.creditAvailable ?? 0) : 0;
  const creditRequested = Math.min(Math.max(0, Number(creditInput) || 0), creditAvailable);

  // Prefill empty fields for a signed-in shopper from their customer record.
  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchMyCustomer()
      .then((row) => {
        if (!active || !row) return;
        const fill = (field, value) => {
          if (value && !getValues(field)) setValue(field, value, { shouldValidate: true });
        };
        fill("name", [row.first_name, row.last_name].filter(Boolean).join(" "));
        fill("phone", row.phone);
        fill("email", row.email || user.email);
        fill("line1", row.address);
      })
      .catch((error) => console.warn("resolve_my_customer failed; checkout not prefilled", error));
    return () => {
      active = false;
    };
  }, [user, getValues, setValue]);

  useEffect(() => {
    let active = true;
    setQuoting(true);
    const timer = setTimeout(async () => {
      const payload = { items: lineItems, fulfilment, holderKey: guestHolderKey() };
      if (pincode) payload.pincode = pincode;
      if (appliedCode) payload.code = appliedCode;
      if (creditRequested > 0) payload.creditRequested = creditRequested;
      try {
        const res = await quote(payload);
        if (!active) return;
        if (res.live === false) {
          onCheckoutOff();
          return;
        }
        setResponse(res);
        setQuoteError(false);
        if (pincode && res.pincode?.ok) {
          onPincodePlace?.(autofillFromPincode(pincode, res.pincode, autofilled.current, getValues, setValue));
        }
        if (appliedCode) {
          const status = res.code?.status ?? "invalid";
          setCodeNotice({ ok: status === "ok", text: CODE_MESSAGES[status] ?? CODE_MESSAGES.invalid, detail: status === "ok" ? res.code?.message : null });
          // Drop a rejected code so later re-quotes don't count as more failed attempts.
          if (status !== "ok") setAppliedCode("");
        }
      } catch (error) {
        if (!active) return;
        console.warn("checkout-quote failed", { code: error.code, status: error.status, message: error.message });
        setQuoteError(true);
      } finally {
        if (active) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [lineItems, fulfilment, pincode, appliedCode, creditRequested, requoteTick, onCheckoutOff, onPincodePlace, getValues, setValue]);

  function applyCode() {
    const code = codeInput.trim();
    if (!code) return;
    setCodeNotice(null);
    setAppliedCode(code);
  }

  function removeCode() {
    setAppliedCode("");
    setCodeInput("");
    setCodeNotice(null);
  }

  function onCreditChange(e) {
    const raw = e.target.value;
    if (raw === "") {
      setCreditInput("");
      return;
    }
    const n = Math.max(0, Number(raw) || 0);
    setCreditInput(String(n > creditAvailable ? creditAvailable : raw));
  }

  async function placeOrder(values) {
    setSubmitting(true);
    setNotice(null);
    try {
      const payload = {
        attemptKey,
        items: lineItems,
        fulfilment: values.fulfilment,
        address: toAddress(values),
        holderKey: guestHolderKey(),
      };
      if (appliedCode) payload.code = appliedCode;
      if (creditRequested > 0) payload.creditRequested = creditRequested;
      const res = await createOrder(payload);
      rememberPendingOrder(res.orderRef);
      if (res.paid) {
        navigate(`/order/${res.orderRef}?t=${encodeURIComponent(res.accessToken)}`);
        return;
      }
      const cashfree = await loadCashfree(res.cashfreeMode);
      // Redirects this tab to Cashfree; it returns to /order/:ref?t=… afterwards.
      await cashfree.checkout({ paymentSessionId: res.paymentSessionId, redirectTarget: "_self" });
    } catch (error) {
      console.warn("create-order failed", { code: error.code, status: error.status, message: error.message });
      setSubmitting(false);
      if (error.code === "checkout_off") {
        onCheckoutOff();
        return;
      }
      if (error.code === "price_changed" || error.code === "out_of_stock") setRequoteTick((t) => t + 1);
      if (error.code === "invalid_code") {
        setAppliedCode("");
        setCodeNotice({ ok: false, text: CODE_MESSAGES.invalid });
      }
      setNotice(createOrderMessage(error.code));
    }
  }

  const q = response?.quote;
  // Soft note only: out-of-UP orders are accepted and the owner confirms fulfilment (2026-10-30).
  const stateValue = watch("state");
  const outsideUp =
    !pickup && (response?.pincode?.inUp === false || (Boolean(stateValue) && stateValue !== UP_STATE));
  const unavailable = response?.unavailable ?? [];
  const canPay =
    formState.isValid &&
    Boolean(q) &&
    !quoting &&
    !quoteError &&
    !submitting &&
    // The quote on screen must be for the chosen option: a pickup quote has no pincode.
    (pickup ? response.shippingSource === "pickup" : response.pincode?.ok === true) &&
    unavailable.length === 0;
  const nudgeAmount = q ? q.subtotal - q.promoDiscount : items.reduce((s, i) => s + i.price * i.quantity, 0);

  return (
    <div>
      <h2 className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Order summary</h2>
      {q ? (
        <CheckoutSummary response={response} hasPincode={Boolean(pincode)} calculating={quoting} />
      ) : (
        <p className="text-sm font-sans text-storefront-muted py-3">{quoteError ? "" : "Calculating your total…"}</p>
      )}
      {!pickup && (
        <div className="pt-4">
          <FreeShippingNudge amount={nudgeAmount} cartItems={items} />
        </div>
      )}

      <div className="mt-6 space-y-2">
        <label htmlFor="checkout-code" className="block text-xs font-sans tracking-wide text-storefront-charcoal">
          Gift card / promo code
        </label>
        <div className="flex gap-2">
          <input
            id="checkout-code"
            value={codeInput}
            disabled={Boolean(appliedCode)}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyCode();
              }
            }}
            className="flex-1 border border-storefront-border px-3 py-2 text-sm font-sans"
          />
          {appliedCode ? (
            <button type="button" onClick={removeCode} className="border border-storefront-charcoal px-4 text-xs font-sans tracking-widest uppercase">
              Remove
            </button>
          ) : (
            <button
              type="button"
              onClick={applyCode}
              disabled={!codeInput.trim()}
              className="border border-storefront-charcoal px-4 text-xs font-sans tracking-widest uppercase disabled:opacity-40"
            >
              Apply
            </button>
          )}
        </div>
        {codeNotice && (
          <p role="status" className={`text-xs font-sans ${codeNotice.ok ? "text-green-700" : "text-red-600"}`}>
            {codeNotice.text}
            {codeNotice.detail && <span className="block text-storefront-muted">{codeNotice.detail}</span>}
          </p>
        )}
      </div>

      {creditAvailable > 0 && (
        <div className="mt-4 space-y-2">
          <label htmlFor="checkout-credit" className="block text-xs font-sans tracking-wide text-storefront-charcoal">
            Use store credit
          </label>
          <input
            id="checkout-credit"
            type="number"
            min="0"
            max={creditAvailable}
            step="1"
            value={creditInput}
            onChange={onCreditChange}
            className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
          />
          <p className="text-xs font-sans text-storefront-muted">Available ₹{formatRupees(creditAvailable)}</p>
        </div>
      )}

      {outsideUp && (
        <p className="mt-4 text-sm font-sans text-storefront-muted">{OUTSIDE_UP_NOTE}</p>
      )}
      {unavailable.length > 0 && (
        <div role="alert" className="mt-4 text-sm font-sans text-red-600 space-y-1">
          {unavailable.map((u) => (
            <p key={u.variantId}>{unavailableText(u, items)}</p>
          ))}
        </div>
      )}
      {quoteError && (
        <p role="alert" className="mt-4 text-sm font-sans text-red-600">
          We couldn't load your total.{" "}
          <button type="button" className="underline" onClick={() => setRequoteTick((t) => t + 1)}>
            Try again
          </button>
        </p>
      )}
      {notice && (
        <p role="alert" className="mt-4 text-sm font-sans text-red-600">{notice}</p>
      )}

      <div className="mt-8 flex flex-col gap-4">
        <button
          type="button"
          disabled={!canPay}
          onClick={handleSubmit(placeOrder)}
          className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 px-8 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {q && q.gatewayAmount > 0 ? `Pay ₹${formatRupees(q.gatewayAmount)}` : "Place order"}
        </button>
        <Link to="/cart" className="text-xs font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2 text-center">
          Back to cart
        </Link>
      </div>
    </div>
  );
}
