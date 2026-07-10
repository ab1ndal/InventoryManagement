import React from "react";

export default function PolicySection({ heading, body }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-xl font-semibold text-storefront-charcoal mb-3">
        {heading}
      </h2>
      {body.map((para, i) => (
        <p
          key={i}
          className="text-sm text-storefront-muted font-sans leading-relaxed mb-3"
        >
          {para}
        </p>
      ))}
    </section>
  );
}
