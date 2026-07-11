import React from "react";
import { Navigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Seo from "../components/Seo";
import { useCart } from "../context/CartContext";
import { addressSchema, shippingFee, INDIAN_STATES } from "../lib/checkout";

const WHATSAPP = "919810873280";

function subtotalOf(items) {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

// Builds the WhatsApp message: order lines + the address the shopper just
// entered, so the store can act on it without any order being created here.
function whatsappHref(items, subtotal, shipping, address) {
  const lines = items
    .map((i) => `• ${i.name} (${i.size}/${i.color}) ×${i.quantity} — ₹${(i.price * i.quantity).toLocaleString("en-IN")}`)
    .join("\n");
  const addressLines = [
    address.name,
    address.phone,
    address.email,
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.pincode}`,
  ]
    .filter(Boolean)
    .join("\n");
  const text =
    `Hi, I’d like to order:\n${lines}\n\n` +
    `Subtotal: ₹${subtotal.toLocaleString("en-IN")}\n` +
    `Shipping: ${shipping === 0 ? "Free" : `₹${shipping}`}\n` +
    `Total: ₹${(subtotal + shipping).toLocaleString("en-IN")}\n\n` +
    `Deliver to:\n${addressLines}`;
  // encodeURIComponent so address/product text with &, #, + etc. doesn't
  // corrupt or truncate the prefilled message (newlines become %0A).
  return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(text)}`;
}

export default function CheckoutPage() {
  const { items } = useCart();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isValid },
  } = useForm({
    resolver: zodResolver(addressSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      pincode: "",
    },
  });

  if (!items.length) {
    return <Navigate to="/cart" replace />;
  }

  const subtotal = subtotalOf(items);
  const shipping = shippingFee(subtotal);
  const total = subtotal + shipping;
  const address = watch();

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

          <section>
            <h2 className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Shipping address</h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="line1" className="sr-only">Address line 1</label>
                <input
                  id="line1"
                  {...register("line1")}
                  placeholder="Address line 1"
                  className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                />
                {errors.line1 && <p className="text-xs text-red-600 mt-1">{errors.line1.message}</p>}
              </div>
              <div>
                <label htmlFor="line2" className="sr-only">Address line 2 (optional)</label>
                <input
                  id="line2"
                  {...register("line2")}
                  placeholder="Address line 2 (optional)"
                  className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                />
              </div>
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
                  <label htmlFor="pincode" className="sr-only">Pincode</label>
                  <input
                    id="pincode"
                    {...register("pincode")}
                    placeholder="Pincode"
                    className="w-full border border-storefront-border px-3 py-2 text-sm font-sans"
                  />
                  {errors.pincode && <p className="text-xs text-red-600 mt-1">{errors.pincode.message}</p>}
                </div>
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
          </section>
        </div>

        <div>
          <h2 className="font-sans text-xs tracking-widest uppercase text-storefront-muted mb-4">Order summary</h2>
          <ul className="divide-y divide-storefront-border border-t border-storefront-border">
            {items.map((i) => (
              <li key={i.variant_id} className="flex justify-between py-3 text-sm font-sans text-storefront-charcoal">
                <span>{i.name} ({i.size}/{i.color}) ×{i.quantity}</span>
                <span className="tabular-nums">₹{(i.price * i.quantity).toLocaleString("en-IN")}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-storefront-border pt-4 mt-2 space-y-2 text-sm font-sans text-storefront-charcoal">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">₹{subtotal.toLocaleString("en-IN")}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span className="tabular-nums">{shipping === 0 ? "Free" : `₹${shipping.toLocaleString("en-IN")}`}</span>
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
      </form>
    </div>
  );
}
