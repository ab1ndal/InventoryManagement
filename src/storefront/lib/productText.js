// AI-written captions wrap random phrases in Markdown bold (**…**). The
// storefront shows plain prose, so the markers are dropped — paired or not —
// rather than half-rendered as stray asterisks.
export function stripMarkdown(text) {
  return (text ?? "").replace(/\*\*/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

const WHATSAPP_NUMBER = "919810873280";

// Orders and questions are handled on WhatsApp; the product id lets the shop
// find the exact piece without the customer describing it.
export function whatsappProductUrl({ name, productid, pageUrl, soldOut = false }) {
  const message = soldOut
    ? `Hi, ${name} (${productid}) is sold out. Can you make it for me? ${pageUrl}`
    : `Hi, I'm interested in ${name} (${productid}). ${pageUrl}`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// Lets a shopper who found nothing ask the shop for it, with their search words.
export function whatsappSearchUrl(query) {
  const message = `Hi, I'm looking for "${query}" and could not find it on the website.`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

// Asks the shop about a colour the product page has no picture of. It promises no photo, because the shop may not be able to send one quickly.
export function whatsappColourQuestionUrl({ productid, colour }) {
  const message = `Hi, can you tell me about ${productid} in ${colour}?`;
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
