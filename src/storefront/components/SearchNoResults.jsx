import React from "react";
import { Link } from "react-router-dom";
import { NAV_LINKS } from "../lib/siteConfig";
import { whatsappSearchUrl } from "../lib/productText";

const CATEGORY_LINKS = NAV_LINKS.filter((l) => l.to.startsWith("/collections/") && !l.highlight);

// Shown when a search finds nothing: a way back into the catalogue, and the shop's WhatsApp.
export default function SearchNoResults({ query, onNavigate }) {
  return (
    <div className="px-4 py-6">
      <p className="text-sm font-sans text-storefront-charcoal">No products match “{query}”.</p>
      <p className="mt-4 text-xs font-sans text-storefront-muted">Browse instead</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {CATEGORY_LINKS.map((l) => (
          <li key={l.to}>
            <Link
              to={l.to}
              onClick={onNavigate}
              className="inline-block border border-storefront-border px-3 py-1.5 text-xs font-sans text-storefront-charcoal hover:border-storefront-charcoal transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <a
        href={whatsappSearchUrl(query)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 inline-block bg-[#25D366] text-storefront-charcoal px-4 py-2 text-xs font-sans font-medium tracking-wide hover:opacity-90 transition-opacity"
      >
        Ask us on WhatsApp
      </a>
    </div>
  );
}
