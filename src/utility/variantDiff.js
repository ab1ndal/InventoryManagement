// Pure diff between a stored variant and its upsert payload, so the history
// log can report size/color edits — not just stock changes. Kept React/Supabase
// free for unit testing.
export const variantChanges = (oldV, newV) => ({
  sizeOrColorChanged: oldV.size !== newV.size || oldV.color !== newV.color,
  stockChanged: Number(oldV.stock) !== Number(newV.stock),
  stockDelta: Number(newV.stock) - Number(oldV.stock),
});
