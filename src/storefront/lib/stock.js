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
