-- Migration: Create supplier_transactions table
-- Run in Supabase dashboard SQL editor

CREATE TABLE IF NOT EXISTS public.supplier_transactions (
  transaction_id serial PRIMARY KEY,
  supplier_id integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('bill','payment')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier
  ON public.supplier_transactions(supplier_id, transaction_date);
