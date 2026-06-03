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

// Edit summary for a product. Scalar fields diff generically; categoryid (a
// short text code like "SA"/"LE") is resolved to its category name for
// readability.
export const productEditSummary = (oldP, newP, categories = []) => {
  const scalarFields = [
    "name",
    "fabric",
    "purchaseprice",
    "retailprice",
    "description",
    "producturl",
    "unit_type",
  ];
  let changed = diffFields(oldP || {}, newP || {}, scalarFields);
  if (oldP && oldP.categoryid !== newP?.categoryid) {
    const catName = (id) =>
      categories.find((c) => c.categoryid === id)?.name || "none";
    const seg = `category "${catName(oldP.categoryid)}"→"${catName(
      newP?.categoryid
    )}"`;
    changed = changed ? `${changed}, ${seg}` : seg;
  }
  return changed;
};
