import React from "react";
import { Heart, MessageCircle, RefreshCw, Ruler, Truck } from "lucide-react";

const WHATSAPP_URL =
  "https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question%20about%20a%20product";

// Keep every claim factual: no returns (in-store exchange only), no secure-checkout
// claim before online checkout ships.
const SIGNALS = [
  { icon: Heart, title: "Handpicked with love", desc: "Every piece chosen by our family" },
  // 2XL–6XL: ~140 of the visible products in stock (2026-10-14).
  { icon: Ruler, title: "Plus sizes up to 6XL", desc: "Hard to find in stores; we keep 2XL to 6XL" },
  { icon: RefreshCw, title: "Easy exchanges in store", desc: "Exchange within 7 days at our store" },
  { icon: MessageCircle, title: "WhatsApp help", desc: "Ask us about size, fabric or fit", href: WHATSAPP_URL },
  { icon: Truck, title: "Free shipping over ₹5,000", desc: "Delivered across India" },
];

function Signal({ icon: Icon, title, desc }) {
  return (
    <>
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-storefront-gold/10">
        <Icon size={18} className="text-storefront-gold" aria-hidden="true" />
      </span>
      <span>
        <span className="block font-sans text-sm font-medium leading-tight text-storefront-charcoal">
          {title}
        </span>
        <span className="mt-0.5 block font-sans text-xs leading-snug text-storefront-muted">{desc}</span>
      </span>
    </>
  );
}

export default function TrustBar() {
  return (
    <section aria-label="Why shop with us" className="border-y border-storefront-border/70 bg-white px-4 py-8 sm:px-6 lg:px-8">
      <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-x-6 gap-y-5 min-[420px]:grid-cols-2 lg:grid-cols-5">
        {SIGNALS.map((s) => (
          <li key={s.title}>
            {s.href ? (
              <a
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-sm transition-opacity hover:opacity-80"
              >
                <Signal {...s} />
              </a>
            ) : (
              <div className="flex items-center gap-3">
                <Signal {...s} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
