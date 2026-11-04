// What the Add to Cart buttons say while the shopper still owes a choice, so
// they name the real gap instead of always asking for both. Null once both
// are made.
export function missingChoiceLabel({ hasSize, hasColour }) {
  if (hasSize && hasColour) return null;
  if (hasSize) return "Choose a colour";
  if (hasColour) return "Choose a size";
  return "Choose a size and colour";
}

// Which picker row to point at: size comes first, and the colour row only
// exists once a size is chosen.
export function missingChoiceRow({ hasSize, hasColour }) {
  if (hasSize && hasColour) return null;
  return hasSize ? "colour" : "size";
}
