-- Utility function: returns live schema info for all public tables.
-- Used by Claude Code to inspect current DB state before writing migrations.
-- Apply once: run this in Supabase SQL editor or via supabase db push.

CREATE OR REPLACE FUNCTION public.get_schema_info()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_agg(row_to_json(t) ORDER BY t.table_name, t.ordinal_position)
  FROM (
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.column_default,
      c.ordinal_position
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
  ) t;
$$;

-- Restrict to service_role only (anon cannot call this)
REVOKE EXECUTE ON FUNCTION public.get_schema_info() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_schema_info() TO service_role;
