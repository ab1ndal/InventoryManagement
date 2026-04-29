-- Migration: Create supplier_bills table for bill image storage references
-- Run in Supabase dashboard SQL editor

CREATE TABLE IF NOT EXISTS public.supplier_bills (
  bill_id serial PRIMARY KEY,
  transaction_id integer REFERENCES public.supplier_transactions(transaction_id) ON DELETE SET NULL,
  supplier_id integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  image_url text NOT NULL,
  storage_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier
  ON public.supplier_bills(supplier_id);

-- MANUAL STEP (Supabase dashboard):
-- 1. Storage > New bucket > name: 'supplier-bills', public: true
-- 2. Add bucket policy: allow authenticated INSERT (for uploads)
-- 3. Add bucket policy: allow authenticated SELECT (for viewing images)
