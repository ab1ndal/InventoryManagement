-- Server-side wishlist for signed-in storefront customers.
--
-- Guests keep the localStorage wishlist (key "bc_wishlist"); once signed in,
-- WishlistContext merges it into this table so the list follows the customer
-- across devices. Keyed like cart_items: auth.users id + product, one row per
-- pair. Living server-side is what makes future back-in-stock emails possible
-- (product_id index serves "who wished for this product").
--
-- product_id may reference any product, including ones the storefront's anon
-- RLS hides (no photos): the FK check bypasses RLS. Those rows simply drop out
-- of the client's products(...) embed and are not shown until the product
-- becomes visible again.
--
-- Idempotent; no BEGIN/COMMIT (the migration runner rejects transaction
-- commands).

CREATE TABLE IF NOT EXISTS public.wishlist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products(productid) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wishlist_items_user_id_product_id_key UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS wishlist_items_product_id_idx
  ON public.wishlist_items (product_id);

ALTER TABLE public.wishlist_items ENABLE ROW LEVEL SECURITY;

-- Customers never edit a row, only add/remove it, so no UPDATE grant or policy.
-- anon gets nothing: guests use localStorage.
REVOKE ALL ON public.wishlist_items FROM anon;
REVOKE ALL ON public.wishlist_items FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.wishlist_items TO authenticated;

DROP POLICY IF EXISTS "wishlist_items: owner select" ON public.wishlist_items;
CREATE POLICY "wishlist_items: owner select" ON public.wishlist_items
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR is_admin());

DROP POLICY IF EXISTS "wishlist_items: owner insert" ON public.wishlist_items;
CREATE POLICY "wishlist_items: owner insert" ON public.wishlist_items
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wishlist_items: owner delete" ON public.wishlist_items;
CREATE POLICY "wishlist_items: owner delete" ON public.wishlist_items
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
