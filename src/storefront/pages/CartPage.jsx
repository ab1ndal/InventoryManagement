import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import Seo from "../components/Seo";
import { useCart } from "../context/CartContext";

const WHATSAPP = "919810873280";

function subtotalOf(items) {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

function whatsappHref(items, subtotal) {
  const lines = items
    .map((i) => `• ${i.name} (${i.size}/${i.color}) ×${i.quantity} — ₹${(i.price * i.quantity).toLocaleString("en-IN")}`)
    .join("%0A");
  const text = `Hi, I’d like to order:%0A${lines}%0A%0ASubtotal: ₹${subtotal.toLocaleString("en-IN")}`;
  return `https://wa.me/${WHATSAPP}?text=${text}`;
}

export default function CartPage() {
  const { items, updateQty, removeItem, revalidateCart } = useCart();

  useEffect(() => {
    revalidateCart().then((changes) => {
      changes?.forEach((c) => {
        if (c.type === "removed") toast.warning(`${c.name} is no longer available and was removed.`);
        if (c.type === "capped") toast.warning(`${c.name}: quantity reduced to available stock.`);
        if (c.type === "repriced") toast.info(`${c.name}: price updated.`);
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = subtotalOf(items);

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Seo title="Your cart" noindex />
        <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">Your cart is empty</h1>
        <Link to="/shop" className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
      <Seo title="Your cart" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-8">Your cart</h1>

      <ul className="divide-y divide-storefront-border">
        {items.map((i) => (
          <li key={i.variant_id} className="flex gap-4 py-5">
            <div className="w-20 h-24 flex-shrink-0 bg-storefront-cream overflow-hidden">
              {i.image_url && <img src={i.image_url} alt={i.name} loading="lazy" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-sans text-sm text-storefront-charcoal">{i.name}</p>
              <p className="text-xs text-storefront-muted font-sans">{i.size} · {i.color}</p>
              <div className="flex items-center gap-3 mt-2">
                <div className="flex items-center border border-storefront-border">
                  <button aria-label="Decrease" onClick={() => updateQty(i.variant_id, i.quantity - 1)} className="w-8 h-8">−</button>
                  <span className="w-8 text-center text-sm tabular-nums">{i.quantity}</span>
                  <button aria-label="Increase" onClick={() => updateQty(i.variant_id, i.quantity + 1)} className="w-8 h-8">+</button>
                </div>
                <button onClick={() => removeItem(i.variant_id)} className="text-xs font-sans text-storefront-muted hover:text-storefront-charcoal underline underline-offset-2">
                  Remove
                </button>
              </div>
            </div>
            <p className="font-sans text-sm tabular-nums text-storefront-charcoal">
              ₹{(i.price * i.quantity).toLocaleString("en-IN")}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8 border-t border-storefront-border pt-6 flex flex-col items-end gap-4">
        <p className="font-sans text-sm text-storefront-charcoal">
          Subtotal <span className="font-semibold tabular-nums">₹{subtotal.toLocaleString("en-IN")}</span>
        </p>
        <p className="text-xs text-storefront-muted font-sans">Shipping calculated at checkout.</p>
        <button disabled className="w-full sm:w-auto bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 px-8 opacity-40 cursor-not-allowed">
          Online checkout launching soon
        </button>
        <a
          href={whatsappHref(items, subtotal)}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto text-center bg-[#25D366] text-white font-sans text-xs tracking-widest uppercase py-4 px-8 hover:opacity-90 transition-opacity"
        >
          Order on WhatsApp
        </a>
      </div>
    </div>
  );
}
