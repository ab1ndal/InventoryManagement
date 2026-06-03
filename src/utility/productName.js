// Helpers for the product "name" field, which is auto-composed from
// fabric + category. Kept pure (no React/zod) so they are unit-testable.

// Auto-composed product name, e.g. ("Silk", "Saree") -> "Silk - Saree".
export const composeProductName = (fabric, categoryName) =>
  [fabric, categoryName].filter(Boolean).join(" - ");

// Whether blurring fabric/category should overwrite the current name.
//
// New products: always compose (the field is the only way to fill the name).
// Existing products: only when fabric or category actually changed — otherwise
// a stray blur silently rewrites a stored name (e.g. "Silk-Saree" ->
// "Silk - Saree") and pollutes the history log with a phantom rename.
export const shouldRecomposeName = ({
  isNewProduct,
  fabricChanged,
  categoryChanged,
}) => isNewProduct || fabricChanged || categoryChanged;
