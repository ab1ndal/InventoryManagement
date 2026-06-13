-- Utility: lets `npm run migrate` apply schema/migration_*.sql files via REST.
-- Apply once manually in the Supabase SQL editor before first use.

-- Tracks which migration files have been applied.
CREATE TABLE IF NOT EXISTS public._migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._migrations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public._migrations TO service_role;

-- Runs arbitrary SQL. service_role only — never expose to anon/authenticated.
CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE query;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;

-- Pre-existing migration files were applied by hand before this tracking
-- table existed — mark them done so `npm run migrate` doesn't replay them.
INSERT INTO public._migrations (filename) VALUES
  ('migration_activity_log.sql'),
  ('migration_exchanges_survive_source_bill_edit.sql'),
  ('migration_fabric_cleanup.sql'),
  ('migration_monthly_sales_history.sql'),
  ('migration_profile_is_active.sql'),
  ('migration_rls_all_tables.sql'),
  ('migration_rls_monthly_sales_history.sql'),
  ('migration_supplier_bills.sql'),
  ('migration_supplier_pipeline.sql'),
  ('migration_supplier_transactions.sql')
ON CONFLICT (filename) DO NOTHING;
