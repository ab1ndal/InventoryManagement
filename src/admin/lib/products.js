// src/admin/lib/products.js
// Read-only product and category lookups shared by the admin CLI and, later,
// the admin screens. Functions take the Supabase client as a parameter.
// Imports carry .js extensions for Node's ESM loader (see customers.js).
import { encodePriceToZCode } from "../../utility/zCode.js";
import { sortVariantsBySizeColor } from "../../utility/sortVariants.js";

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
  if (!code) throw new Error("Product code is required");

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
