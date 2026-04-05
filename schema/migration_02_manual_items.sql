-- Phase 2: Create manual_items table with BCX-format primary keys and generation RPC
-- Run manually in Supabase SQL Editor

-- 1. Create manual_items table
CREATE TABLE public.manual_items (
  manual_item_id character varying(20) NOT NULL,
  name character varying(100) NOT NULL,
  categoryid character varying(10) NULL,
  size character varying(20) NULL,
  color character varying(50) NULL,
  purchase_price numeric(10, 2) NULL DEFAULT 0,
  mrp numeric(10, 2) NULL DEFAULT 0,
  created_at timestamp without time zone NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT manual_items_pkey PRIMARY KEY (manual_item_id),
  CONSTRAINT manual_items_categoryid_fkey FOREIGN KEY (categoryid)
    REFERENCES public.categories (categoryid)
);

-- 2. RPC to get the max numeric suffix for BCX IDs
--    p_prefix is e.g. 'BCX25'
--    Returns the max of the number formed by stripping the 'BCX' prefix (3 chars).
--    Example: 'BCX25001' -> substring from 4 = '25001' -> 25001
CREATE OR REPLACE FUNCTION public.get_max_manual_item_suffix(p_prefix text)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT MAX(SUBSTRING(manual_item_id FROM 4)::bigint)
  FROM public.manual_items
  WHERE manual_item_id LIKE p_prefix || '%'
    AND SUBSTRING(manual_item_id FROM 4) ~ '^[0-9]+$';
$$;
