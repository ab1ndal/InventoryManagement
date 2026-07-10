import React from "react";
import { Globe, ShieldCheck, RefreshCw, Lock } from "lucide-react";

const SIGNALS = [
  { icon: Globe, title: "Pan-India Shipping", desc: "Free on orders above ₹5,000" },
  { icon: ShieldCheck, title: "100% Authentic", desc: "Sourced directly from artisans" },
  { icon: RefreshCw, title: "Easy Returns", desc: "Hassle-free 7-day returns" },
  { icon: Lock, title: "Secure Checkout", desc: "Encrypted & safe payments" },
];

export default function TrustBar() {
  return (
    <section className="bg-storefront-charcoal py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-8">
        {SIGNALS.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex flex-col items-center text-center gap-3">
            <div className="w-10 h-10 rounded-full border border-storefront-gold/40 flex items-center justify-center">
              <Icon size={18} className="text-storefront-gold" />
            </div>
            <div>
              <p className="font-display font-semibold text-storefront-cream text-lg leading-tight">
                {title}
              </p>
              <p className="font-sans text-xs text-storefront-cream/50 mt-0.5 leading-snug">
                {desc}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
