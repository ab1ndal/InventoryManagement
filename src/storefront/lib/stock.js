// A product is sold out only when its variants are known and none has stock.
// Missing variant data (a query that didn't load it, a wishlist snapshot, a
// product with no variants) is not sold out: unknown stock must never hide
// the price or put a false "Sold out" on a card.
export function isSoldOut(variants) {
  return (
    Array.isArray(variants) &&
    variants.length > 0 &&
    variants.every((v) => !(Number(v.stock) > 0))
  );
}

// Photos of colours still in stock go first, so a sold-out colour's photo is
// never the one a shopper or Google sees first (owner 2026-11-15). The order
// within each group is kept. A photo is pushed back only when its colour
// matches known variants and none of them has stock: an untagged photo, a
// colour tag no variant uses, or missing variant data leaves it where it is.
// `images` must already be in displayorder; Array.prototype.sort is stable.
export function orderImagesByStock(images, variants) {
  if (!Array.isArray(images) || !Array.isArray(variants) || !variants.length) return images;
  const inStock = new Map();
  for (const v of variants) {
    const colour = String(v.color ?? "").trim().toLowerCase();
    if (colour) inStock.set(colour, inStock.get(colour) || Number(v.stock) > 0);
  }
  const soldOut = (img) => {
    const colour = String(img.productcolor ?? "").trim().toLowerCase();
    return inStock.get(colour) === false;
  };
  return [...images].sort((a, b) => soldOut(a) - soldOut(b));
}
