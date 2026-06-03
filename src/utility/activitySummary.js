// Pure helpers for building human-readable activity-log summaries.
// Summaries must never contain UUIDs — use these labels instead.

export const money = (n) => {
  const value = Number(n) || 0;
  return "₹" + value.toLocaleString("en-IN");
};

// productsizecolors stores size + color. Display as "Color / Size".
export const variantLabel = (size, color) => {
  const parts = [color, size].filter((p) => p != null && String(p).trim() !== "");
  return parts.length ? parts.join(" / ") : "variant";
};

export const customerName = (c) => {
  if (!c) return "walk-in";
  const name = [c.first_name, c.last_name]
    .filter((p) => p != null && String(p).trim() !== "")
    .join(" ");
  return name || "walk-in";
};

// Returns "field old→new, field2 old2→new2" for changed fields only.
// Strings are quoted; numbers/other are bare. Empty string if nothing changed.
export const diffFields = (oldObj, newObj, fields) => {
  const fmt = (v) => (typeof v === "string" ? `"${v}"` : String(v));
  return fields
    .filter((f) => oldObj?.[f] !== newObj?.[f])
    .map((f) => `${f} ${fmt(oldObj?.[f])}→${fmt(newObj?.[f])}`)
    .join(", ");
};
