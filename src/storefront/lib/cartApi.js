import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../lib/productImage";

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

// Read the caller's server cart (RLS scopes rows to auth.uid()), joined to live
// product data, and resolve a thumbnail per line. Returns canonical item shape.
export async function fetchServerCart() {
  const { data, error } = await supabase
    .from("cart_items")
    .select(
      "variant_id, product_id, quantity, productsizecolors(size, color, stock), products(name, retailprice)"
    );
  if (error || !data) return [];
  return Promise.all(
    data.map(async (row) => ({
      variant_id: row.variant_id,
      product_id: row.product_id,
      quantity: row.quantity,
      name: row.products?.name ?? "",
      size: row.productsizecolors?.size ?? "",
      color: row.productsizecolors?.color ?? "",
      price: Number(row.products?.retailprice ?? 0),
      image_url: await getProductImageUrl(row.product_id, { width: 400, quality: 70 }),
    }))
  );
}

export async function upsertItem({ variant_id, product_id, quantity }) {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase
    .from("cart_items")
    .upsert({ user_id, variant_id, product_id, quantity }, { onConflict: "user_id,variant_id" });
  if (error) throw error;
}

export async function removeServerItem(variant_id) {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase
    .from("cart_items")
    .delete()
    .eq("user_id", user_id)
    .eq("variant_id", variant_id);
  if (error) throw error;
}

export async function clearServerCart() {
  const user_id = await currentUserId();
  if (!user_id) return;
  const { error } = await supabase.from("cart_items").delete().eq("user_id", user_id);
  if (error) throw error;
}

// Live stock (per variant) + price (per product) for the given cart items.
export async function fetchLiveVariantData(items) {
  if (!items.length) return {};
  const variantIds = items.map((i) => i.variant_id);
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const [{ data: variants }, { data: products }] = await Promise.all([
    supabase.from("productsizecolors").select("variantid, stock").in("variantid", variantIds),
    supabase.from("products").select("productid, retailprice").in("productid", productIds),
  ]);
  const priceByProduct = {};
  (products || []).forEach((p) => (priceByProduct[p.productid] = Number(p.retailprice)));
  const out = {};
  (variants || []).forEach((v) => {
    const item = items.find((i) => i.variant_id === v.variantid);
    out[v.variantid] = { stock: Number(v.stock), price: item ? priceByProduct[item.product_id] : undefined };
  });
  return out;
}
