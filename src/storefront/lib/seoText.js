// Search-facing wording shared by the app and the server's HTML, so the two always match.
// Pure, and free of app imports, because the server renderer loads it too.

export const HOME_TITLE = "Sarees, Lehengas & Sherwanis in Ghaziabad";
export const HOME_DESCRIPTION =
  "Handpicked sarees, lehengas, suits and sherwanis from Bindal's Creation in Ghaziabad. Seen a look you love? Our in-house tailors can make it for you.";
export const SHOP_TITLE = "Shop Indian Ethnic Wear";
export const SHOP_DESCRIPTION = "Browse our handpicked sarees, lehengas, suits, and ethnic wear.";

// Google shows about this many characters of a description.
const DESCRIPTION_MAX = 160;
// Below this, the product's own text says too little to stand alone in a search result.
const THIN_TEXT = 80;

function clip(text) {
  if (text.length <= DESCRIPTION_MAX) return text;
  const cut = text.slice(0, DESCRIPTION_MAX - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

export function productMetaDescription({ name, text, price }) {
  if (text && text.length >= THIN_TEXT) return clip(text);
  const lead = `${name}, ₹${Number(price).toLocaleString("en-IN")}, from Bindal's Creation in Ghaziabad.`;
  return clip(text ? `${lead} ${text}` : lead);
}

export function productImageAlt(name, colour, view, count = 1) {
  const named = colour && !name.toLowerCase().includes(colour.toLowerCase());
  const base = named ? `${name} in ${colour}` : name;
  return count > 1 ? `${base}, view ${view}` : base;
}
