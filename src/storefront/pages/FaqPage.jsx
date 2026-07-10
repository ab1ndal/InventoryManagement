import React from "react";
import StaticPage from "../components/StaticPage";
import { FAQ_ITEMS } from "./faqContent";

function FaqItem({ q, a }) {
  return (
    <details className="group border-b border-storefront-border py-5">
      <summary className="flex items-start justify-between gap-4 cursor-pointer list-none font-display text-lg text-storefront-charcoal">
        <span>{q}</span>
        <span className="text-storefront-gold text-xl leading-none flex-shrink-0 transition-transform duration-200 group-open:rotate-45">
          +
        </span>
      </summary>
      <p className="mt-3 text-sm text-storefront-muted font-sans leading-relaxed">
        {a}
      </p>
    </details>
  );
}

export default function FaqPage() {
  return (
    <StaticPage
      eyebrow="Help"
      title="Frequently Asked Questions"
      seoTitle="FAQ"
      seoDescription="Answers to common questions about delivery, exchanges, payments, sizing, and visiting Bindal's Creations."
    >
      <div>
        {FAQ_ITEMS.map((item) => (
          <FaqItem key={item.q} q={item.q} a={item.a} />
        ))}
      </div>
    </StaticPage>
  );
}
