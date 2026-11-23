// Plain module with no React imports: the server renderer (src/seoRender)
// builds the same addresses, so both sides must share one slug rule.

// No 0/o/1/l/i, so an id read aloud or copied by hand cannot be mistaken.
export const PUBLIC_ID_RE = /^[a-hj-km-np-z2-9]{5}$/;

// Old addresses used the BC code; they answer 410 rather than 404.
export const LEGACY_CODE_RE = /^bc\d{5,}$/i;

const MAX_SLUG_LENGTH = 50;

// The detail after "with" stays on the page only, so editing it usually
// leaves the address unchanged. Word boundaries keep "Without" whole.
const WITH_CLAUSE_RE = /\bwith\b[\s\S]*$/i;

export function productSlug(title) {
  let slug = (title ?? "")
    .replace(WITH_CLAUSE_RE, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG_LENGTH) {
    const lastBreak = slug.lastIndexOf("-", MAX_SLUG_LENGTH);
    slug = slug.slice(0, lastBreak > 0 ? lastBreak : MAX_SLUG_LENGTH).replace(/-+$/, "");
  }
  return slug;
}

// Throws rather than returning "/product/undefined": a select that forgot
// public_id should fail loudly in tests, not ship dead links.
export function productPath({ public_id, name }) {
  if (!public_id) throw new Error("productPath: missing public_id");
  const slug = productSlug(name);
  return slug ? `/product/${slug}-${public_id}` : `/product/${public_id}`;
}

// The id alone identifies the product; the slug is returned only so the
// caller can redirect when it no longer matches the current title.
export function parseProductParam(param) {
  const value = (param ?? "").toLowerCase();
  if (LEGACY_CODE_RE.test(value)) return { kind: "legacy" };
  const dash = value.lastIndexOf("-");
  const publicId = value.slice(dash + 1);
  if (!PUBLIC_ID_RE.test(publicId)) return { kind: "invalid" };
  return { kind: "id", publicId, slug: dash > 0 ? value.slice(0, dash) : "" };
}
