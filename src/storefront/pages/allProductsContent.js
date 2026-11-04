// Shared by the React page and the server renderer, so the two cannot drift apart.
export const ALL_PRODUCTS_TITLE = "All Products";
export const ALL_PRODUCTS_DESCRIPTION =
  "Every piece currently in our collection, in one list: sarees, lehengas, suits, kurtis, gowns and menswear.";

// PostgREST caps one response at 1000 rows, so callers page through with a stable order.
export const ALL_PRODUCTS_PAGE = 1000;
