import React from "react";

// A short visible lead, then the rest in a native <details> so products stay near the top on a phone.
// The server HTML (src/seoRender/pages.js) prints the same words, closed <details> included.
export default function CollectionIntro({ title, intro }) {
  return (
    <div className="basis-full max-w-2xl font-sans text-sm text-storefront-muted leading-relaxed">
      <p>{intro.lead}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-storefront-gold hover:underline">More about {title}</summary>
        {intro.more.map((paragraph) => (
          <p key={paragraph} className="mt-2">
            {paragraph}
          </p>
        ))}
      </details>
    </div>
  );
}
