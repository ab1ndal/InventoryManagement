-- Migration: Enable RLS on all public tables
-- Run in Supabase SQL Editor
-- Skips: sizes, cart_items, bill_sequences (already have RLS)

-- Step 1: Helper function to check admin role (SECURITY DEFINER avoids recursion on profiles)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'superadmin')
  );
$$;

-- Step 2: profiles
-- Users can read their own profile (needed for session bootstrap)
-- Admins can do everything
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_read_own" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_admin_all" ON profiles
  FOR ALL USING (is_admin());

-- Step 3: All other tables — admin only

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON customers USING (is_admin());

ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON bills USING (is_admin());

ALTER TABLE bill_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON bill_items USING (is_admin());

ALTER TABLE bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON bill_payments USING (is_admin());

ALTER TABLE bill_salespersons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON bill_salespersons USING (is_admin());

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON products USING (is_admin());

ALTER TABLE productsizecolors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON productsizecolors USING (is_admin());

ALTER TABLE productimages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON productimages USING (is_admin());

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON categories USING (is_admin());

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON suppliers USING (is_admin());

ALTER TABLE stocktransactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON stocktransactions USING (is_admin());

ALTER TABLE stocktransactiongroups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON stocktransactiongroups USING (is_admin());

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON discounts USING (is_admin());

ALTER TABLE discount_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON discount_usage USING (is_admin());

ALTER TABLE vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON vouchers USING (is_admin());

ALTER TABLE mockups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON mockups USING (is_admin());

ALTER TABLE saleslocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON saleslocations USING (is_admin());

ALTER TABLE salesmethods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON salesmethods USING (is_admin());

ALTER TABLE salespersons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON salespersons USING (is_admin());

ALTER TABLE manual_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON manual_items USING (is_admin());

ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON exchanges USING (is_admin());
