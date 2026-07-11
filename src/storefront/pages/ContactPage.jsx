import React from "react";
import StaticPage from "../components/StaticPage";
import { MapPin, Phone, Mail, MessageCircle, Clock } from "lucide-react";

const ADDRESS = "58 Sihani Gate, Near Durga Bhabhi Chowk, Ghaziabad, Uttar Pradesh 201001";
const MAP_SRC = `https://www.google.com/maps?q=${encodeURIComponent(ADDRESS)}&output=embed`;

export default function ContactPage() {
  return (
    <StaticPage
      eyebrow="Visit"
      title="Visit Us"
      seoTitle="Contact & Store"
      seoDescription="Visit Bindal's Creations at 58 Sihani Gate, Near Durga Bhabhi Chowk, Ghaziabad. Call or WhatsApp us any day 8 AM–8 PM (closed Tuesdays)."
      containerClassName="max-w-6xl"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-14">
        {/* Left: details */}
        <div className="space-y-6 font-sans text-sm text-storefront-charcoal">
          <div className="flex items-start gap-3">
            <MapPin size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <span>{ADDRESS}</span>
          </div>
          <div className="flex items-start gap-3">
            <Clock size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <span>Open 8 AM – 8 PM every day. Closed Tuesdays.</span>
          </div>
          <div className="flex items-start gap-3">
            <Phone size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <a href="tel:+919810873280" className="hover:text-storefront-gold transition-colors">
              +91 98108 73280
            </a>
          </div>
          <div className="flex items-start gap-3">
            <MessageCircle size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <a
              href="https://wa.me/919810873280?text=Hi,%20I%20have%20a%20question"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-storefront-gold transition-colors"
            >
              WhatsApp us
            </a>
          </div>
          <div className="flex items-start gap-3">
            <Mail size={18} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <a
              href="mailto:bindalscreations@gmail.com"
              className="hover:text-storefront-gold transition-colors"
            >
              bindalscreations@gmail.com
            </a>
          </div>

          {/* Store photo placeholders */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {["Storefront photo", "Interior photo"].map((label) => (
              <div
                key={label}
                className="aspect-[4/3] bg-storefront-border/30 rounded-sm flex items-center justify-center text-storefront-muted text-[11px] tracking-wide text-center px-2"
              >
                [{label}]
              </div>
            ))}
          </div>
        </div>

        {/* Right: map */}
        <div className="min-h-[320px]">
          <iframe
            title="Bindal's Creations store location"
            src={MAP_SRC}
            className="w-full h-full min-h-[320px] rounded-sm border border-storefront-border"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </div>
    </StaticPage>
  );
}
