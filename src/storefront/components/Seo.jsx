import React from "react";

const SITE_NAME = "Bindal's Creations";
const DEFAULT_OG_IMAGE = "/LOGO-BindalsCreation.png";

// React 19 hoists <title>/<meta>/<link> rendered anywhere into <head> and
// dedupes across route changes — no react-helmet needed. JSON-LD <script>
// is valid anywhere in the document for crawlers, so we render it in place.
export default function Seo({
  title,
  description,
  image,
  type = "website",
  noindex = false,
  jsonLd,
}) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const rawImage = image || DEFAULT_OG_IMAGE;
  const ogImage = rawImage.startsWith("http") ? rawImage : `${origin}${rawImage}`;
  const url = typeof window !== "undefined" ? window.location.href : undefined;

  return (
    <>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {noindex && <meta name="robots" content="noindex" />}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:type" content={type} />
      <meta property="og:image" content={ogImage} />
      {url && <meta property="og:url" content={url} />}
      <meta name="twitter:card" content="summary_large_image" />
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
    </>
  );
}
