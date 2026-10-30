import React, { useCallback, useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Seo from "../components/Seo";
import FreeShippingNudge from "../components/FreeShippingNudge";
import { useCart } from "../context/CartContext";
import { formatSize } from "../lib/sizes";
import { checkoutSchema, shippingFee, INDIAN_STATES } from "../lib/checkout";
import { getCheckoutLive } from "../lib/ordersApi";
import { SHOP_ADDRESS } from "../lib/siteConfig";
import LiveCheckout from "../components/LiveCheckout";

const WHATSAPP = "919810873280";

function subtotalOf(items) {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

// Builds the WhatsApp message: order lines + the address the shopper just
// entered, so the store can act on it without any order being created here.
function whatsappHref(items, subtotal, shipping, address) {
  const pickup = address.fulfilment === "pickup";
  const lines = items
    .map((i) => `• ${i.name} (${formatSize(i.size)}/${i.color}) ×${i.quantity} — ₹${(i.price * i.quantity).toLocaleString("en-IN")}`)
    .join("\n");
  const addressLines = (
    pickup
      ? [address.name, address.phone, address.email]
      : [
          address.name,
          address.phone,
          address.email,
          address.line1,
          address.line2,
          address.landmark && `Landmark: ${address.landmark}`,
          `${address.city}, ${address.state} ${address.pincode}`,
        ]
  )
    .filter(Boolean)
    .join("\n");
  const text =
    `Hi, I’d like to order:\n${lines}\n\n` +
    `Subtotal: ₹${subtotal.toLocaleString("en-IN")}\n` +
    `Shipping: ${shipping === 0 ? "Free" : `₹${shipping}`}\n` +
    `Total: ₹${(subtotal + shipping).toLocaleString("en-IN")}\n\n` +
    `${pickup ? "Store pickup" : "Deliver to"}:\n${addressLines}`;
  // encodeURIComponent so address/product text with &, #, + etc. doesn't
  // corrupt or truncate the prefilled message (newlines become %0A).
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

export default function CheckoutPage() {
  const { items, renewHolds } = useCart();
  // Until the switch is read (and whenever it is off) the page is exactly the
  // WhatsApp flow; the live checkout never renders on an unknown state.
  const [live, setLive] = useState(false);

  useEffect(() => {
    let active = true;
    getCheckoutLive()
      .then((value) => {
        if (active) setLive(value);
      })
      .catch((error) => console.warn("checkout_live read failed; using WhatsApp checkout", error));
    return () => {
      active = false;
    };
  }, []);

  // Keep the cart's units reserved while the shopper fills in the form.
  useEffect(() => {
    renewHolds();
  }, [renewHolds]);

  const goOffline = useCallback(() => setLive(false), []);

  // City/State from the live quote's pincode lookup. Shown as a read-only line
  // while the form still holds exactly those values, until the shopper picks Edit.
  const [place, setPlace] = useState(null);
  const [editPlace, setEditPlace] = useState(false);

  const form = useForm({
    resolver: zodResolver(checkoutSchema),
    // Errors appear once a field has been visited, not while the shopper is
    // still working down the form (isValid is tracked regardless of mode).
    mode: "onTouched",
    defaultValues: {
      fulfilment: "ship",
      name: "",
      phone: "",
      email: "",
      line1: "",
      line2: "",
      landmark: "",
      city: "",
      state: "",
      pincode: "",
    },
  });
  const {
    register,
    handleSubmit,
    watch,
    setFocus,
    formState: { errors, isValid },
  } = form;

  useEffect(() => {
    if (editPlace) setFocus("city");
  }, [editPlace, setFocus]);

  if (!items.length) {
    return <Navigate to="/cart" replace />;
  }

  const address = watch();
  const pickup = address.fulfilment === "pickup";
  const subtotal = subtotalOf(items);
  const shipping = pickup ? 0 : shippingFee(subtotal);
  const total = subtotal + shipping;
  const placeLocked =
    !editPlace &&
    Boolean(place?.city && place?.state) &&
    place.pincode === (address.pincode || "").trim() &&
    address.city === place.city &&
    address.state === place.state;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Seo title="Checkout" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-8">Checkout</h1>

      <form onSubmit={handleSubmit(() => {})} className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-8">
          <section>
            <h2 className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Contact</h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="name" className="sr-only">Full name</label>
                <input
                  id="name"
                  {...register("name")}
                  placeholder="Full name"
                  className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name.message}</p>}
              </div>
              <div>
                <label htmlFor="phone" className="sr-only">Phone</label>
                <input
                  id="phone"
                  {...register("phone")}
                  placeholder="Phone (10-digit mobile)"
                  className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                />
                {errors.phone && <p className="text-xs text-red-600 mt-1">{errors.phone.message}</p>}
              </div>
              <div>
                <label htmlFor="email" className="sr-only">Email (optional)</label>
                <input
                  id="email"
                  type="email"
                  {...register("email")}
                  placeholder="Email (optional)"
                  className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
              </div>
            </div>
          </section>

          <fieldset>
            <legend className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Delivery</legend>
            <div className="space-y-3">
              <div className={`border ${pickup ? "border-storefront-border" : "border-storefront-charcoal"}`}>
                <label className="flex items-start gap-3 px-3 py-3 text-sm font-sans text-storefront-charcoal cursor-pointer">
                  <input type="radio" value="ship" {...register("fulfilment")} className="mt-0.5" />
                  <span>Ship to me</span>
                </label>
                {!pickup && (
                  <div className="space-y-3 px-3 pb-4">
                    <div>
                      <label htmlFor="pincode" className="sr-only">Pincode</label>
                      <input
                        id="pincode"
                        {...register("pincode")}
                        placeholder="Pincode"
                        inputMode="numeric"
                        autoComplete="postal-code"
                        className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                      />
                      {errors.pincode && <p className="text-xs text-red-600 mt-1">{errors.pincode.message}</p>}
                    </div>
                    {placeLocked ? (
                      <div className="flex items-center justify-between gap-3 text-sm font-sans text-storefront-charcoal">
                        <span data-testid="pincode-place">
                          {address.city}, {address.state}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditPlace(true)}
                          className="text-xs text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2"
                        >
                          Edit
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="city" className="sr-only">City</label>
                          <input
                            id="city"
                            {...register("city")}
                            placeholder="City"
                            className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                          />
                          {errors.city && <p className="text-xs text-red-600 mt-1">{errors.city.message}</p>}
                        </div>
                        <div>
                          <label htmlFor="state" className="sr-only">State</label>
                          <select
                            id="state"
                            {...register("state")}
                            className="w-full border border-storefront-border px-3 py-2 text-sm font-sans bg-white"
                          >
                            <option value="">Select state</option>
                            {INDIAN_STATES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          {errors.state && <p className="text-xs text-red-600 mt-1">{errors.state.message}</p>}
                        </div>
                      </div>
                    )}
                    <div>
                      <label htmlFor="line1" className="sr-only">Flat, House no., Building, Apartment</label>
                      <input
                        id="line1"
                        {...register("line1")}
                        placeholder="Flat, House no., Building, Apartment"
                        className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                      />
                      {errors.line1 && <p className="text-xs text-red-600 mt-1">{errors.line1.message}</p>}
                    </div>
                    <div>
                      <label htmlFor="line2" className="sr-only">Area, Street, Sector, Village</label>
                      <input
                        id="line2"
                        {...register("line2")}
                        placeholder="Area, Street, Sector, Village"
                        className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                      />
                      {errors.line2 && <p className="text-xs text-red-600 mt-1">{errors.line2.message}</p>}
                    </div>
                    <div>
                      <label htmlFor="landmark" className="sr-only">Landmark (optional)</label>
                      <input
                        id="landmark"
                        {...register("landmark")}
                        placeholder="Landmark (optional), e.g. Near Durga Bhabhi Chowk"
                        className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                      />
                      {errors.landmark && <p className="text-xs text-red-600 mt-1">{errors.landmark.message}</p>}
                    </div>
                  </div>
                )}
              </div>
              <label
                className={`flex items-start gap-3 border px-3 py-3 text-sm font-sans text-storefront-charcoal cursor-pointer ${
                  pickup ? "border-storefront-charcoal" : "border-storefront-border"
                }`}
              >
                <input type="radio" value="pickup" {...register("fulfilment")} className="mt-0.5" />
                <span>
                  Pick up at the shop (No Shipping fees)
                  <span className="block text-xs text-storefront-muted mt-1">{SHOP_ADDRESS}</span>
                  <span className="block text-xs text-storefront-muted">
                    We'll message you when it's ready (usually 1–2 days).
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </div>

        {live ? (
          <LiveCheckout items={items} form={form} onCheckoutOff={goOffline} onPincodePlace={setPlace} />
        ) : (
          <div>
            <h2 className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Order summary</h2>
            <ul className="divide-y divide-storefront-border border-t border-storefront-border">
              {items.map((i) => (
                <li key={i.variant_id} className="flex justify-between py-3 text-sm font-sans text-storefront-charcoal">
                  <span>{i.name} ({formatSize(i.size)}/{i.color}) ×{i.quantity}</span>
                  <span className="tabular-nums">₹{(i.price * i.quantity).toLocaleString("en-IN")}</span>
                </li>
              ))}
            </ul>
            {!pickup && (
              <div className="pt-4">
                <FreeShippingNudge amount={subtotal} cartItems={items} />
              </div>
            )}
            <div className="border-t border-storefront-border pt-4 mt-2 space-y-2 text-sm font-sans text-storefront-charcoal">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">₹{subtotal.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span>Shipping</span>
                <span className="tabular-nums">
                  {pickup ? "Free (store pickup)" : shipping === 0 ? "Free" : `₹${shipping.toLocaleString("en-IN")}`}
                </span>
              </div>
              <div className="flex justify-between font-semibold pt-2 border-t border-storefront-border">
                <span>Total</span>
                <span className="tabular-nums">₹{total.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <div className="mt-8 flex flex-col gap-4">
              <button
                type="submit"
                disabled
                className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 px-8 opacity-40 cursor-not-allowed"
              >
                Place order — online payment launching soon
              </button>
              {isValid ? (
                <a
                  href={whatsappHref(items, subtotal, shipping, address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full text-center bg-[#25D366] text-white font-sans text-xs tracking-widest uppercase py-4 px-8 hover:opacity-90 transition-opacity"
                >
                  Complete your order on WhatsApp
                </a>
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full text-center bg-[#25D366] text-white font-sans text-xs tracking-widest uppercase py-4 px-8 opacity-40 cursor-not-allowed"
                >
                  Complete your order on WhatsApp
                </button>
              )}
              <Link to="/cart" className="text-xs font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2 text-center">
                Back to cart
              </Link>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
