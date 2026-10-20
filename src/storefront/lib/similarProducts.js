import { COLLECTIONS } from "./collections";

export const RAIL_SIZE = 8;

// Candidates priced within this fraction of the current product get price
// points; beyond it a ₹4k lehenga next to a ₹17k one reads as unrelated.
const PRICE_BAND = 0.4;

const WEIGHTS = { sameCategory: 3, price: 3, colour: 2, fabric: 1 };

/**
 * The header category collection that contains `categoryid` (e.g. "ST" →
 * Suits, which also holds "RMS"). Small raw categories borrow from their
 * siblings so the rail is not empty. Null when the category is ungrouped.
 */
export function categoryGroup(categoryid) {
  return (
    COLLECTIONS.find((c) => !c.productIds && c.categoryIds?.includes(categoryid)) || null
  );
}

function inStock(product) {
  return (product.productsizecolors ?? []).some((v) => Number(v.stock) > 0);
}

function colourSet(colours) {
  return new Set(colours.filter(Boolean).map((c) => String(c).trim().toLowerCase()));
}

function priceScore(price, target) {
  if (!(target > 0) || !(price > 0)) return 0;
  const gap = Math.abs(price - target) / target;
  return gap >= PRICE_BAND ? 0 : 1 - gap / PRICE_BAND;
}

/**
 * Orders candidates by how alike they are to `current`: same raw category,
 * nearby price, a shared colour, same fabric. Drops the current product and
 * anything sold out. Ties keep input order (newest first from the query).
 *
 * @param {{productid:string, categoryid:string, retailprice:number, fabric?:string}} current
 * @param {string[]} currentColours  colours of the current product's variants
 * @param {object[]} candidates  products with `productsizecolors(stock, color)`
 */
export function rankSimilar(current, currentColours, candidates, limit = RAIL_SIZE) {
  const colours = colourSet(currentColours);
  const fabric = current.fabric?.trim().toLowerCase();

  return candidates
    .filter((p) => p.productid !== current.productid && inStock(p))
    .map((p, index) => {
      const sharesColour = (p.productsizecolors ?? []).some((v) =>
        colours.has(String(v.color ?? "").trim().toLowerCase())
      );
      const score =
        (p.categoryid === current.categoryid ? WEIGHTS.sameCategory : 0) +
        WEIGHTS.price * priceScore(Number(p.retailprice), Number(current.retailprice)) +
        (sharesColour ? WEIGHTS.colour : 0) +
        (fabric && p.fabric?.trim().toLowerCase() === fabric ? WEIGHTS.fabric : 0);
      return { p, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ p }) => p);
}
