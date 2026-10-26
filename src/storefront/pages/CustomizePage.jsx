import React from "react";
import { Link } from "react-router-dom";
import { MessageCircle, ChevronDown, MapPin } from "lucide-react";
import Seo from "../components/Seo";
import { CUSTOMIZE, WHATSAPP_REQUEST_URL, EMAIL_REQUEST_URL } from "./customizeContent";

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2";

function RequestCta() {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
      <a
        href={WHATSAPP_REQUEST_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center justify-center gap-2.5 bg-storefront-whatsapp text-white font-sans text-sm font-medium tracking-widest uppercase px-8 py-4 shadow-[0_8px_24px_-12px_rgba(37,211,102,0.7)] hover:brightness-95 active:scale-[0.98] transition duration-200 ${FOCUS}`}
      >
        <MessageCircle size={18} />
        Send your photo on WhatsApp
      </a>
      <a
        href={EMAIL_REQUEST_URL}
        className={`text-center font-sans text-sm text-storefront-muted underline underline-offset-4 decoration-storefront-border hover:text-storefront-charcoal hover:decoration-storefront-charcoal transition-colors ${FOCUS}`}
      >
        or email us
      </a>
    </div>
  );
}

export default function CustomizePage() {
  return (
    <div className="bg-storefront-cream">
      <Seo
        title="Custom Tailoring"
        description="Seen a lehenga, saree or sherwani you love? Send us the photo and our in-house tailors in Ghaziabad will make it in your size. Get a quote on WhatsApp."
      />

      {/* Hero: copy left, still life right (stacked on phones, copy first) */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-16 sm:pt-16 sm:pb-24 grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center">
        <div>
          <h1 className="font-display font-semibold text-storefront-charcoal text-[clamp(2.6rem,6vw,4.75rem)] leading-[1.02] tracking-[-0.02em] [text-wrap:balance] mb-6">
            {CUSTOMIZE.title}
          </h1>
          <p className="font-sans text-lg text-storefront-warm leading-relaxed max-w-[34rem] [text-wrap:pretty] mb-9">
            {CUSTOMIZE.lede}
          </p>
          <RequestCta />
        </div>
        <div className="relative mr-3 sm:mr-5">
          {/* Offset gold hairline frame for depth */}
          <div aria-hidden="true" className="absolute inset-0 translate-x-3 translate-y-3 sm:translate-x-5 sm:translate-y-5 border border-storefront-gold/40 rounded-sm" />
          <img
            src="/customize/workroom.webp"
            alt="A design sketch of a lehenga beside silk swatches, a measuring tape and a half-stitched blouse on a dress form"
            width={900}
            height={1125}
            fetchpriority="high"
            className="relative w-full aspect-[4/5] object-cover rounded-sm shadow-[0_30px_60px_-30px_rgba(68,64,60,0.55)]"
          />
        </div>
      </section>

      {/* The differentiator, said big */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-24">
        <blockquote className="border-l-2 border-storefront-gold pl-6 sm:pl-10 max-w-3xl">
          <p className="font-display italic text-storefront-charcoal text-[clamp(1.6rem,3.4vw,2.5rem)] leading-snug tracking-[-0.01em] [text-wrap:balance]">
            {CUSTOMIZE.pitch}
          </p>
        </blockquote>
      </section>

      {/* How it works */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20">
        <h2 className="font-display text-3xl font-semibold text-storefront-charcoal tracking-[-0.01em] mb-8">
          How it works
        </h2>
        <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-8">
          {CUSTOMIZE.steps.map((step, i) => (
            <li key={step.title} className="border-t border-storefront-charcoal/15 pt-5">
              <span className="block font-display text-4xl text-storefront-gold tabular-nums leading-none mb-4" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-display text-xl text-storefront-charcoal leading-snug mb-1.5">{step.title}</h3>
              <p className="font-sans text-sm text-storefront-muted leading-relaxed">{step.desc}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Quick facts: hairline strip, not cards */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-storefront-charcoal/15 border-y border-storefront-charcoal/15">
          {CUSTOMIZE.facts.map((f) => (
            <div key={f.label} className="flex flex-col-reverse text-center bg-storefront-cream py-7 px-2 sm:px-6">
              <dt className="font-sans text-xs tracking-wide text-storefront-muted mt-2">{f.label}</dt>
              <dd className="font-display text-[clamp(1.5rem,3vw,2rem)] font-semibold text-storefront-charcoal tabular-nums">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* What we make + the fine print */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 sm:pb-20 grid grid-cols-1 lg:grid-cols-[0.8fr_1.2fr] gap-10 lg:gap-16">
        <div>
          <h2 className="font-display text-3xl font-semibold text-storefront-charcoal tracking-[-0.01em] mb-5">
            What we make
          </h2>
          <div className="grid grid-cols-2 gap-6">
            {CUSTOMIZE.makes.map((group) => (
              <div key={group.group}>
                <h3 className="font-display italic text-lg text-storefront-gold mb-2">{group.group}</h3>
                <ul className="font-sans text-sm text-storefront-charcoal space-y-1.5">
                  {group.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="self-start">
        <p className="font-sans text-sm text-storefront-charcoal mb-4">{CUSTOMIZE.reassurance}</p>
        <details className="group border-y border-storefront-charcoal/15">
          <summary className={`flex items-center justify-between gap-4 cursor-pointer list-none py-5 font-display text-xl text-storefront-charcoal ${FOCUS}`}>
            A few things to know
            <ChevronDown size={20} className="flex-shrink-0 text-storefront-muted transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <ul className="list-disc marker:text-storefront-gold pl-5 pb-6 space-y-2.5 font-sans text-sm text-storefront-warm leading-relaxed">
            {CUSTOMIZE.goodToKnow.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
        </div>
      </section>

      {/* Closing: same warm palette a shade deeper, so it reads as one page */}
      <section className="bg-[#F2ECE3]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 md:gap-12 items-center">
          <div>
            <h2 className="font-display text-3xl sm:text-4xl font-semibold text-storefront-charcoal tracking-[-0.01em] [text-wrap:balance] mb-3">
              Prefer to talk in person?
            </h2>
            <p className="font-sans text-sm text-storefront-warm leading-relaxed flex items-start gap-2 max-w-xl">
              <MapPin size={16} className="mt-0.5 flex-shrink-0 text-storefront-gold" />
              <span>
                Bring your photos or fabric to 58 Sihani Gate Market, Ghaziabad. Open 10 AM to 8:30 PM, closed
                Tuesdays. Call{" "}
                <a href="tel:+919810873280" className={`text-storefront-charcoal underline underline-offset-2 ${FOCUS}`}>
                  +91 98108 73280
                </a>{" "}
                or{" "}
                <Link to="/contact" className={`text-storefront-charcoal underline underline-offset-2 ${FOCUS}`}>
                  get directions
                </Link>
                .
              </span>
            </p>
          </div>
          <RequestCta />
        </div>
      </section>
    </div>
  );
}
