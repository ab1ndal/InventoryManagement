// src/admin/lib/products.js
// Read-only product and category lookups shared by the admin CLI and, later,
// the admin screens. Functions take the Supabase client as a parameter.
// Imports carry .js extensions for Node's ESM loader (see customers.js).
import { decodeZCodeToPrice, encodePriceToZCode } from "../../utility/zCode.js";
import { sortVariantsBySizeColor } from "../../utility/sortVariants.js";

export class ProductInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductInputError";
  }
}

const PRODUCT_COLUMNS =
  "productid, name, categoryid, fabric, purchaseprice, retailprice, unit_type";

/** "bc-252051 " → "BC252051": slips write codes with dashes and spaces. */
export function normalizeProductCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function listCategories(client) {
  const { data, error } = await client
    .from("categories")
    .select("categoryid, name")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

/**
 * Products for a code, each with category name, cost Z-code and variants
 * (size, colour, stock), variants in the app's size order. An exact productid
 * match returns just that product; otherwise up to 10 partial matches, like
 * the billing screen's inventory picker. [] when nothing matches.
 */
export async function findProducts(client, rawCode) {
  const code = normalizeProductCode(rawCode);
  if (!code) throw new ProductInputError("Product code is required");

  const { data: exact, error: exactErr } = await client
    .from("products_admin")
    .select(PRODUCT_COLUMNS)
    .eq("productid", code);
  if (exactErr) throw exactErr;

  let products = exact ?? [];
  if (products.length === 0) {
    const { data, error } = await client
      .from("products_admin")
      .select(PRODUCT_COLUMNS)
      .ilike("productid", `%${code}%`)
      .order("productid")
      .limit(10);
    if (error) throw error;
    products = data ?? [];
  }
  return withVariants(client, products);
}

// Adds category name, cost Z-code and size-ordered variants to product rows.
async function withVariants(client, products) {
  if (products.length === 0) return [];
  const ids = products.map((p) => p.productid);
  const categoryIds = [...new Set(products.map((p) => p.categoryid).filter(Boolean))];
  const [variantsRes, categoriesRes] = await Promise.all([
    client
      .from("productsizecolors")
      .select("variantid, productid, size, color, stock")
      .in("productid", ids),
    categoryIds.length
      ? client.from("categories").select("categoryid, name").in("categoryid", categoryIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (variantsRes.error) throw variantsRes.error;
  if (categoriesRes.error) throw categoriesRes.error;

  const categoryName = Object.fromEntries(
    (categoriesRes.data ?? []).map((c) => [c.categoryid, c.name]),
  );
  return products.map((p) => ({
    ...p,
    category_name: categoryName[p.categoryid] ?? null,
    cost_zcode: encodePriceToZCode(Number(p.purchaseprice)),
    variants: sortVariantsBySizeColor(
      (variantsRes.data ?? []).filter((v) => v.productid === p.productid),
    ).map(({ productid, ...v }) => v),
  }));
}

// Enough to cover any realistic category + cost/MRP match, and keeps the
// variant lookup's id list well inside PostgREST's URL and 1000-row limits.
const SEARCH_CANDIDATES = 200;
const SEARCH_RESULTS = 25;

/**
 * Find inventory products when a slip has no usable code: by any mix of name
 * substring, category id, cost (Z-code like "ZBEAF" or a number), MRP, and
 * variant colour substring / in-stock. Returns up to 25 products in
 * findProducts' shape; with colour/in-stock, only matching variants are kept
 * and products left with none are dropped. With `near` (the code written on a
 * slip), each product gets `code_distance` (digits to change, add or drop to
 * reach its code) and the closest codes come first: the owner's way of finding
 * a miswritten code is a category + MRP listing scanned for a code a few
 * digits off.
 */
export async function searchProducts(client, { name, categoryid, cost, mrp, color, inStock = false, near } = {}) {
  const has = (v) => v != null && String(v).trim() !== "";
  if (![name, categoryid, cost, mrp].some(has)) {
    throw new ProductInputError("Give at least one of name, category, cost or MRP");
  }
  let query = client.from("products_admin").select(PRODUCT_COLUMNS);
  if (has(name)) query = query.ilike("name", `%${String(name).trim()}%`);
  if (has(categoryid)) query = query.eq("categoryid", String(categoryid).trim());
  if (has(cost)) {
    const price = decodeZCodeToPrice(cost);
    if (!(price > 0)) throw new ProductInputError(`Invalid cost "${cost}" (Z-code like ZBEAF or a number)`);
    query = query.eq("purchaseprice", price);
  }
  if (has(mrp)) {
    const n = Number(mrp);
    if (!Number.isFinite(n)) throw new ProductInputError(`Invalid MRP "${mrp}"`);
    query = query.eq("retailprice", n);
  }
  const { data, error } = await query.order("productid").limit(SEARCH_CANDIDATES);
  if (error) throw error;

  const colorNeedle = has(color) ? String(color).trim().toLowerCase() : null;
  const filtering = colorNeedle !== null || inStock;
  const written = has(near) ? normalizeProductCode(near) : null;
  const rows = written
    ? (data ?? [])
        .map((p) => ({ ...p, code_distance: editDistance(written, p.productid) }))
        .sort((a, b) => a.code_distance - b.code_distance || a.productid.localeCompare(b.productid))
    : data ?? [];
  return (await withVariants(client, rows))
    .map((p) =>
      filtering
        ? {
            ...p,
            variants: p.variants.filter(
              (v) =>
                (!colorNeedle || String(v.color ?? "").toLowerCase().includes(colorNeedle)) &&
                (!inStock || Number(v.stock) > 0),
            ),
          }
        : p,
    )
    .filter((p) => !filtering || p.variants.length > 0)
    .slice(0, SEARCH_RESULTS);
}

// Characters to change, add or drop to turn one code into the other (Levenshtein).
export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Digit pairs that handwriting on slips mixes up most (slip misreads so far).
const CONFUSABLE_DIGITS = [["3", "5"], ["4", "9"], ["1", "7"], ["1", "2"], ["6", "8"]];
const isConfusable = (a, b) => CONFUSABLE_DIGITS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
const NEAR_RESULTS = 25;

/**
 * Codes one digit off a written code, for when the code on a slip disagrees with the slip's
 * rate or colour (a miswritten or misread digit). Every digit of the code's number is tried
 * with each other digit; existing products are kept when they match the slip's MRP (exact),
 * colour (variant substring) and in-stock, as searchProducts filters. Look-alike digits
 * (3/5, 4/9, 1/7, 1/2, 6/8) rank first, then products with stock.
 * Returns { written, written_matches, near }: the written code's product (or null), whether
 * it fits the given MRP/colour (null for a filter not given), and the near products, each
 * with `changed` ("3→5 at digit 6") and `lookalike`.
 */
export async function nearProducts(client, { code: rawCode, mrp, color, inStock = false } = {}) {
  const code = normalizeProductCode(rawCode);
  const m = /^([A-Z]*)(\d+)$/.exec(code);
  if (!m) throw new ProductInputError(`Product code "${rawCode ?? ""}" must be letters then digits, like BC253248`);
  const has = (v) => v != null && String(v).trim() !== "";
  let price = null;
  if (has(mrp)) {
    price = Number(mrp);
    if (!Number.isFinite(price)) throw new ProductInputError(`Invalid MRP "${mrp}"`);
  }
  const colorNeedle = has(color) ? String(color).trim().toLowerCase() : null;

  const [, prefix, digits] = m;
  const changes = {};
  for (let i = 0; i < digits.length; i++) {
    for (const d of "0123456789") {
      if (d === digits[i]) continue;
      changes[`${prefix}${digits.slice(0, i)}${d}${digits.slice(i + 1)}`] = {
        changed: `${digits[i]}→${d} at digit ${prefix.length + i + 1}`,
        lookalike: isConfusable(digits[i], d),
      };
    }
  }

  const { data, error } = await client
    .from("products_admin")
    .select(PRODUCT_COLUMNS)
    .in("productid", [code, ...Object.keys(changes)]);
  if (error) throw error;
  const products = await withVariants(client, data ?? []);

  const colorOk = (v) => !colorNeedle || String(v.color ?? "").toLowerCase().includes(colorNeedle);
  const written = products.find((p) => p.productid === code) ?? null;
  const writtenMatches = written && {
    mrp: price === null ? null : Number(written.retailprice) === price,
    color: colorNeedle === null ? null : written.variants.some(colorOk),
  };

  const inStockCount = (p) => p.variants.filter((v) => Number(v.stock) > 0).length;
  const near = products
    .filter((p) => p.productid !== code)
    .filter((p) => price === null || Number(p.retailprice) === price)
    .map((p) => ({
      ...p,
      ...changes[p.productid],
      variants: p.variants.filter((v) => colorOk(v) && (!inStock || Number(v.stock) > 0)),
    }))
    .filter((p) => (colorNeedle === null && !inStock) || p.variants.length > 0)
    .sort((a, b) => b.lookalike - a.lookalike || inStockCount(b) - inStockCount(a) || a.productid.localeCompare(b.productid))
    .slice(0, NEAR_RESULTS);

  return { written, written_matches: writtenMatches, near };
}
