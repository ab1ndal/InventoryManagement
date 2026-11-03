// Turns a page description into the HTML a crawler receives. Pure: no network, no clock.

export const SITE_URL = "https://www.bindalscreations.com";
export const SITE_NAME = "Bindal's Creation";

export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );

// "<" is the only character that can end a <script> early, and JSON allows it escaped.
const jsonLdTag = (data) =>
  `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

function headTags({ title, description, canonical, image, type, noindex }) {
  const fullTitle = title ? `${title} — ${SITE_NAME}` : SITE_NAME;
  const ogImage = image || `${SITE_URL}/logo512.png`;
  // data-ssr: the app removes these on start, because its own <Seo> takes over from there.
  const tags = [
    `<title data-ssr>${esc(fullTitle)}</title>`,
    description && `<meta data-ssr name="description" content="${esc(description)}"/>`,
    `<meta data-ssr name="robots" content="${noindex ? "noindex" : "index, follow"}"/>`,
    canonical && `<link data-ssr rel="canonical" href="${esc(SITE_URL + canonical)}"/>`,
    `<meta data-ssr property="og:site_name" content="${esc(SITE_NAME)}"/>`,
    `<meta data-ssr property="og:title" content="${esc(fullTitle)}"/>`,
    description && `<meta data-ssr property="og:description" content="${esc(description)}"/>`,
    `<meta data-ssr property="og:type" content="${esc(type || "website")}"/>`,
    `<meta data-ssr property="og:image" content="${esc(ogImage)}"/>`,
    canonical && `<meta data-ssr property="og:url" content="${esc(SITE_URL + canonical)}"/>`,
    `<meta data-ssr name="twitter:card" content="summary_large_image"/>`,
  ];
  return tags.filter(Boolean).join("");
}

// The shell's own title, description and robots tags would otherwise compete with the page's.
const SHELL_HEAD_TAGS = [
  /<title>[\s\S]*?<\/title>/,
  /<meta\s+name="description"[\s\S]*?\/?>/,
  /<meta\s+name="robots"[\s\S]*?\/?>/,
  /<meta\s+name="googlebot"[\s\S]*?\/?>/,
];
const ROOT_DIV = '<div id="root"></div>';

export function renderHtml(shell, page) {
  if (!shell.includes(ROOT_DIV) || !shell.includes("</head>")) {
    throw new Error("shell is missing the root div or </head>");
  }
  const stripped = SHELL_HEAD_TAGS.reduce((html, tag) => html.replace(tag, ""), shell);
  const head = headTags(page) + (page.jsonLd || []).map(jsonLdTag).join("");
  // Function replacers: page text may hold "$&", which a plain string replacement would expand.
  return stripped
    .replace("</head>", () => `${head}</head>`)
    .replace(ROOT_DIV, () => `<div id="root">${page.bodyHtml || ""}</div>`);
}
