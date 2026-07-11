import React from "react";
import { Link } from "react-router-dom";
import { Instagram, Facebook, MessageCircle, Mail, Phone } from "lucide-react";

export default function StorefrontFooter() {
  return (
    <>
      <footer className="bg-storefront-charcoal text-storefront-cream font-sans">
        {/* Main footer */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-10">
          {/* Brand */}
          <div className="lg:col-span-1">
            <img
              src="/LOGO-BindalsCreation.png"
              alt="Bindal's Creations"
              className="h-12 w-auto object-contain mb-4 brightness-0 invert"
            />
            <p className="font-display text-lg text-storefront-cream/80 leading-relaxed mb-5">
              Rooted in tradition,<br />crafted with love.
            </p>
            <div className="flex gap-4">
              <a
                href="https://instagram.com/bindals_creation_shop"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="text-storefront-cream/60 hover:text-storefront-gold transition-colors"
              >
                <Instagram size={20} />
              </a>
              <a
                href="https://www.facebook.com/profile.php?id=61579168104897"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Facebook"
                className="text-storefront-cream/60 hover:text-storefront-gold transition-colors"
              >
                <Facebook size={20} />
              </a>
            </div>
          </div>

          {/* Shop */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Shop
            </h4>
            <ul className="space-y-2.5 text-sm text-storefront-cream/70">
              {["Sarees", "Lehengas", "Salwar Suits", "Kurtis", "Dupattas"].map(
                (cat) => (
                  <li key={cat}>
                    <Link
                      to="/shop"
                      className="hover:text-storefront-gold transition-colors"
                    >
                      {cat}
                    </Link>
                  </li>
                )
              )}
              <li>
                <Link
                  to="/collections"
                  className="hover:text-storefront-gold transition-colors"
                >
                  Collections
                </Link>
              </li>
            </ul>
          </div>

          {/* Help */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Help
            </h4>
            <ul className="space-y-2.5 text-sm text-storefront-cream/70">
              {[
                { label: "Shop All", to: "/shop" },
                { label: "About", to: "/about" },
                { label: "Contact", to: "/contact" },
                { label: "FAQ", to: "/faq" },
                { label: "Size Guide", to: "/size-guide" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="hover:text-storefront-gold transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Policies */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Policies
            </h4>
            <ul className="space-y-2.5 text-sm text-storefront-cream/70">
              {[
                { label: "Shipping Policy", to: "/policies/shipping" },
                { label: "Returns & Exchange", to: "/policies/returns" },
                { label: "Privacy Policy", to: "/policies/privacy" },
                { label: "Terms of Service", to: "/policies/terms" },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link
                    to={to}
                    className="hover:text-storefront-gold transition-colors"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-display text-base font-semibold tracking-widest uppercase text-storefront-gold mb-4">
              Get in Touch
            </h4>
            <ul className="space-y-3 text-sm text-storefront-cream/70">
              <li className="flex items-start gap-2.5">
                <Phone size={15} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
                <span>+91 98108 73280</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Mail size={15} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
                <span>bindalscreations@gmail.com</span>
              </li>
              <li className="flex items-start gap-2.5">
                <MessageCircle size={15} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
                <a
                  href="https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question%20about%20a%20product"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-storefront-gold transition-colors"
                >
                  WhatsApp us
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Business legitimacy */}
        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-[11px] text-storefront-cream/40 leading-relaxed">
            BINDAL'S CREATION · 58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, Uttar Pradesh 201001 · GSTIN 09ABVPB4203A1Z4
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-storefront-cream/40">
            <span>© {new Date().getFullYear()} Bindal's Creations. All rights reserved.</span>
            <div className="flex items-center gap-3 font-mono tracking-wide">
              <span className="border border-white/20 rounded px-2 py-0.5">VISA</span>
              <span className="border border-white/20 rounded px-2 py-0.5">MASTERCARD</span>
              <span className="border border-white/20 rounded px-2 py-0.5">UPI</span>
              <span className="border border-white/20 rounded px-2 py-0.5">PAYTM</span>
            </div>
          </div>
        </div>
      </footer>

      {/* WhatsApp FAB */}
      <a
        href="https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question%20about%20a%20product"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat on WhatsApp"
        className="fixed bottom-6 right-6 z-50 bg-[#25D366] text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-150 cursor-pointer"
      >
        <MessageCircle size={26} strokeWidth={1.8} />
      </a>
    </>
  );
}
