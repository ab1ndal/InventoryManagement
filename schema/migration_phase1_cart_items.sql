-- Phase 1: Cart — logged-in user cart persistence
-- Apply in Supabase dashboard before Phase 2 auth work begins.

CREATE TABLE IF NOT EXISTS cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES productsizecolors(variantid),
  product_id  text NOT NULL REFERENCES products(productid),
  quantity    int  NOT NULL CHECK (quantity > 0),
  added_at    timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, variant_id)
);

-- RLS: users read/write own rows only
ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cart_items: user owns row"
  ON cart_items
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
