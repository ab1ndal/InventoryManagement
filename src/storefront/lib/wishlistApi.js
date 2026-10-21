import { supabase } from "lib/supabaseClient";

const TABLE = "wishlist_items";

// 42P01: Postgres undefined_table. PGRST205: PostgREST cannot find the table in
// its schema cache. Either means schema/migration_wishlist_items.sql has not
// been applied yet, and the wishlist should stay local-only.
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

export function isMissingTableError(error) {
  return MISSING_TABLE_CODES.has(error?.code);
}

// The caller's wishlist (RLS scopes rows to auth.uid()) as the same snapshot
// shape the guest list stores. One query: products are embedded via the FK.
// Rows whose product the storefront RLS hides come back with products = null
// and are left out.
export async function fetchServerWishlist() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("product_id, products(productid, name, retailprice)")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter((row) => row.products)
    .map(({ products: p }) => ({
      productid: p.productid,
      name: p.name,
      retailprice: Number(p.retailprice),
    }));
}

// ignoreDuplicates (ON CONFLICT DO NOTHING) so re-adding an existing pair is a
// no-op and the table needs no UPDATE grant.
export async function addServerItems(userId, productIds) {
  if (!productIds.length) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      productIds.map((product_id) => ({ user_id: userId, product_id })),
      { onConflict: "user_id,product_id", ignoreDuplicates: true }
    );
  if (error) throw error;
}

export async function removeServerItem(userId, productId) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);
  if (error) throw error;
}
