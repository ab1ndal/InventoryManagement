import React from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ChevronDown, MapPin } from "lucide-react";
import StaticPage from "../components/StaticPage";
import { CUSTOMIZE, WHATSAPP_REQUEST_URL, EMAIL_REQUEST_URL } from "./customizeContent";

function RequestCta() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
      <a
        href={WHATSAPP_REQUEST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 bg-storefront-whatsapp hover:brightness-95 text-white font-sans text-sm font-medium tracking-widest uppercase px-8 py-4 transition"
      >
        <MessageCircle size={18} />
        Send your photo on WhatsApp
      </a>
      <a
        href={EMAIL_REQUEST_URL}
        className="text-center font-sans text-sm text-storefront-muted underline underline-offset-4 hover:text-storefront-charcoal"
      >
        or email us
      </a>
    </div>
  );
}

export default function CustomizePage() {
  return (
    <StaticPage
      title={CUSTOMIZE.title}
      seoTitle="Custom Tailoring"
      seoDescription="Seen a lehenga, saree or sherwani you love? Send us the photo and our in-house tailors in Ghaziabad will make it in your size. Get a quote on WhatsApp."
      containerClassName="max-w-5xl"
    >
      <p className="font-sans text-lg text-storefront-charcoal leading-relaxed max-w-xl -mt-4 mb-3">
        {CUSTOMIZE.lede}
      </p>
      <p className="font-sans text-sm text-storefront-gold font-medium max-w-xl mb-8">{CUSTOMIZE.pitch}</p>
      <RequestCta />

      <ul className="flex flex-wrap gap-2 mt-8 mb-14" aria-label="What we make">
        {CUSTOMIZE.makes.map((item) => (
          <li
            key={item}
            className="font-sans text-xs tracking-wide text-storefront-warm border border-storefront-border bg-storefront-card rounded-full px-3 py-1.5"
          >
            {item}
          </li>
        ))}
      </ul>

      <h2 className="font-display text-2xl font-semibold text-storefront-charcoal mb-6">How it works</h2>
      <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5 mb-14">
        {CUSTOMIZE.steps.map((step, i) => (
          <li key={step.title} className="flex sm:block gap-4">
            <span className="flex flex-shrink-0 w-9 h-9 rounded-full bg-storefront-gold text-white font-display text-base font-semibold items-center justify-center sm:mb-3">
              {i + 1}
            </span>
            <div>
              <h3 className="font-display text-lg text-storefront-charcoal leading-snug">{step.title}</h3>
              <p className="font-sans text-sm text-storefront-muted">{step.desc}</p>
            </div>
          </li>
        ))}
      </ol>

      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
        {CUSTOMIZE.facts.map((f) => (
          <div key={f.label} className="flex flex-col-reverse bg-storefront-card border border-storefront-border rounded-sm px-4 py-5 text-center">
            <dt className="font-sans text-xs text-storefront-muted mt-1">{f.label}</dt>
            <dd className="font-display text-2xl font-semibold text-storefront-charcoal">{f.value}</dd>
          </div>
        ))}
      </dl>

      <details className="group border-y border-storefront-border mb-14">
        <summary className="flex items-center justify-between cursor-pointer list-none py-4 font-sans text-sm font-medium text-storefront-charcoal">
          Before you order: prices, delivery and refunds
          <ChevronDown size={18} className="text-storefront-muted transition-transform group-open:rotate-180" />
        </summary>
        <ul className="list-disc pl-5 pb-5 space-y-2 font-sans text-sm text-storefront-muted leading-relaxed max-w-2xl">
          {CUSTOMIZE.goodToKnow.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>

      <div className="bg-storefront-charcoal text-storefront-cream rounded-sm px-6 py-8 sm:px-10 sm:py-10 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <h2 className="font-display text-2xl font-semibold text-storefront-cream mb-2">Prefer to talk in person?</h2>
          <p className="font-sans text-sm text-storefront-cream/70 flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
            <span>
              Bring your photos or fabric to 58 Sihani Gate Market, Ghaziabad. Open 10 AM to 8:30 PM, closed
              Tuesdays. Call{" "}
              <a href="tel:+919810873280" className="text-storefront-cream underline underline-offset-2">
                +91 98108 73280
              </a>
              .
            </span>
          </p>
        </div>
        <Link
          to="/contact"
          className="inline-flex items-center justify-center border border-storefront-cream/40 hover:bg-storefront-cream hover:text-storefront-charcoal font-sans text-xs font-medium tracking-widest uppercase px-6 py-3 transition-colors"
        >
          Get directions
        </Link>
      </div>
    </StaticPage>
  );
}
