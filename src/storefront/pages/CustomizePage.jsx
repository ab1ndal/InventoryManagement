import React from "react";
import { Link } from "react-router-dom";
import { MessageCircle, Mail, Phone, MapPin } from "lucide-react";
import StaticPage from "../components/StaticPage";
import { CUSTOMIZE, WHATSAPP_REQUEST_URL, EMAIL_REQUEST_URL } from "./customizeContent";

function RequestButtons({ stacked = false }) {
  return (
    <div className={`flex flex-col gap-3 ${stacked ? "" : "sm:flex-row"}`}>
      <a
        href={WHATSAPP_REQUEST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 bg-storefront-whatsapp hover:brightness-95 text-white font-sans text-sm font-medium tracking-widest uppercase px-8 py-3.5 transition"
      >
        <MessageCircle size={18} />
        Send your design on WhatsApp
      </a>
      <a
        href={EMAIL_REQUEST_URL}
        className="inline-flex items-center justify-center gap-2 border border-storefront-charcoal text-storefront-charcoal hover:bg-storefront-charcoal hover:text-storefront-cream font-sans text-sm font-medium tracking-widest uppercase px-8 py-3.5 transition-colors"
      >
        <Mail size={18} />
        Email us instead
      </a>
    </div>
  );
}

export default function CustomizePage() {
  return (
    <StaticPage
      title={CUSTOMIZE.title}
      seoTitle="Custom Tailoring"
      seoDescription="Made-to-order lehengas, sarees, suits, sherwanis and blazers, stitched by our in-house tailors in Ghaziabad. Send your design on WhatsApp for a quote."
      containerClassName="max-w-5xl"
    >
      <p className="font-sans text-base text-storefront-muted leading-relaxed max-w-2xl mb-8">
        {CUSTOMIZE.lede}
      </p>
      <div className="mb-14">
        <RequestButtons />
      </div>

      {/* What we make */}
      <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-5">What we make</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-14">
        {CUSTOMIZE.makes.map((m) => (
          <div key={m.group} className="bg-storefront-card border border-storefront-border rounded-sm p-5">
            <h3 className="font-display text-lg text-storefront-charcoal mb-2">{m.group}</h3>
            <ul className="font-sans text-sm text-storefront-muted space-y-1">
              {m.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* How it works */}
      <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-5">How it works</h2>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-14">
        {CUSTOMIZE.steps.map((step, i) => (
          <li key={step.title}>
            <span className="flex w-8 h-8 rounded-full bg-storefront-charcoal text-storefront-cream font-sans text-sm font-semibold items-center justify-center mb-3">
              {i + 1}
            </span>
            <h3 className="font-display text-lg text-storefront-charcoal mb-1">{step.title}</h3>
            <p className="font-sans text-sm text-storefront-muted leading-relaxed">{step.desc}</p>
          </li>
        ))}
      </ol>

      {/* Good to know */}
      <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-4">Good to know</h2>
      <ul className="max-w-2xl list-disc pl-5 space-y-2 font-sans text-sm text-storefront-charcoal leading-relaxed mb-14">
        {CUSTOMIZE.goodToKnow.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      {/* Visit or call */}
      <div className="border-t border-storefront-border pt-10 grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        <div>
          <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">
            Or come and see us
          </h2>
          <p className="font-sans text-sm text-storefront-muted leading-relaxed mb-4">
            Bring your design, your fabric or just an idea. We'll talk it through, take your measurements
            and give you a quote at the shop.
          </p>
          <div className="space-y-2 font-sans text-sm text-storefront-charcoal">
            <p className="flex items-start gap-2.5">
              <MapPin size={16} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <span>58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad. Open 10 AM to 8:30 PM, closed Tuesdays.</span>
            </p>
            <p className="flex items-start gap-2.5">
              <Phone size={16} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <a href="tel:+919810873280" className="hover:text-storefront-gold transition-colors">
                +91 98108 73280
              </a>
            </p>
          </div>
          <Link
            to="/contact"
            className="inline-block mt-4 text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline"
          >
            Directions and map
          </Link>
        </div>
        <div className="md:pt-12">
          <RequestButtons stacked />
        </div>
      </div>
    </StaticPage>
  );
}
