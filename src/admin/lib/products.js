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
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("productid", code);
  if (exactErr) throw exactErr;

  let products = exact ?? [];
  if (products.length === 0) {
    const { data, error } = await client
      .from("products")
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
 * and products left with none are dropped.
 */
export async function searchProducts(client, { name, categoryid, cost, mrp, color, inStock = false } = {}) {
  const has = (v) => v != null && String(v).trim() !== "";
  if (![name, categoryid, cost, mrp].some(has)) {
    throw new ProductInputError("Give at least one of name, category, cost or MRP");
  }
  let query = client.from("products").select(PRODUCT_COLUMNS);
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
  return (await withVariants(client, data ?? []))
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
