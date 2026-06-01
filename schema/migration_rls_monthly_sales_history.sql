-- Add RLS policy for monthly_sales_history so admin users can read historical data.
-- This table was created without a corresponding entry in migration_rls_all_tables.sql.

ALTER TABLE monthly_sales_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_only" ON monthly_sales_history
  FOR SELECT USING (is_admin());
