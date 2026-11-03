import React from "react";
import { SITE_URL } from "../../seoRender/html";

const SITE_NAME = "Bindal's Creation";
const DEFAULT_OG_IMAGE = "/logo512.png";

// One URL per page: filter and sort query strings point back to the page itself.
function canonicalUrl() {
  if (typeof window === "undefined") return undefined;
  const path = window.location.pathname.replace(/(.)\/$/, "$1");
  return `${SITE_URL}${path}`;
}

// React 19 hoists <title>/<meta>/<link> rendered anywhere into <head> and
// dedupes across route changes — no react-helmet needed. Structured data comes
// from the server's HTML (src/seoRender), where crawlers read it reliably.
export default function Seo({
  title,
  description,
  image,
  type = "website",
  noindex = false,
}) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const rawImage = image || DEFAULT_OG_IMAGE;
  const ogImage = rawImage.startsWith("http") ? rawImage : `${origin}${rawImage}`;
  const url = canonicalUrl();

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
      {url && !noindex && <link rel="canonical" href={url} />}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content={type} />
      <meta property="og:image" content={ogImage} />
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:card" content="summary_large_image" />
    </>
  );
}
