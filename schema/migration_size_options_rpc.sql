-- RPC: returns distinct sizes that exist in productsizecolors.
-- Bypasses the Supabase API row-limit issue on large tables.

CREATE OR REPLACE FUNCTION get_distinct_sizes()
RETURNS TABLE(size TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT psc.size
  FROM productsizecolors psc
  WHERE psc.size IS NOT NULL
  ORDER BY psc.size;
$$;
