// AI-written captions wrap random phrases in Markdown bold (**…**). The
// storefront shows plain prose, so the markers are dropped — paired or not —
// rather than half-rendered as stray asterisks.
export function stripMarkdown(text) {
  return (text ?? "").replace(/\*\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

const WHATSAPP_NUMBER = "919810873280";

// Orders and questions are handled on WhatsApp; the product id lets the shop
// find the exact piece without the customer describing it.
export function whatsappProductUrl({ name, productid, pageUrl }) {
  const message = `Hi, I'm interested in ${name} (${productid}). ${pageUrl}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
