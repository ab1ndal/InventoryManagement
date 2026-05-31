-- Migration: Supplier pipeline — full schema
-- Run in Supabase dashboard SQL editor
-- Date: 2026-05-31

-- ============================================================
-- 1. Extend suppliers table
-- ============================================================
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS gstin                varchar(15),
  ADD COLUMN IF NOT EXISTS pan                  varchar(10),
  ADD COLUMN IF NOT EXISTS address              text,
  ADD COLUMN IF NOT EXISTS opening_balance      numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_balance_date date;

-- ============================================================
-- 2. Create supplier_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_transactions (
  transaction_id   serial PRIMARY KEY,
  supplier_id      integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  type             text    NOT NULL CHECK (type IN ('bill', 'payment', 'advance')),
  amount           numeric(12,2) NOT NULL CHECK (amount > 0),
  transaction_date date    NOT NULL DEFAULT CURRENT_DATE,
  notes            text,
  -- Bill-specific
  invoice_number   varchar(50),
  gross_amount     numeric(12,2),   -- pre-discount subtotal
  discount_amount  numeric(12,2),   -- total discount applied
  taxable_amount   numeric(12,2),
  cgst_amount      numeric(12,2),
  sgst_amount      numeric(12,2),
  igst_amount      numeric(12,2),
  -- Payment/advance-specific
  payment_mode     varchar(20) CHECK (payment_mode IN ('cash', 'upi', 'bank', 'cheque')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier
  ON public.supplier_transactions(supplier_id, transaction_date);

-- ============================================================
-- 3. Create supplier_bills (bill image storage)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_bills (
  bill_id        serial PRIMARY KEY,
  transaction_id integer REFERENCES public.supplier_transactions(transaction_id) ON DELETE SET NULL,
  supplier_id    integer NOT NULL REFERENCES public.suppliers(supplierid) ON DELETE CASCADE,
  image_url      text NOT NULL,
  storage_path   text NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier
  ON public.supplier_bills(supplier_id);

-- MANUAL STEP (Supabase dashboard):
-- Storage > New bucket > name: 'supplier-bills', public: true
-- Add policy: allow authenticated INSERT + SELECT

-- ============================================================
-- 4. Create supplier_bill_line_items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.supplier_bill_line_items (
  line_item_id   serial PRIMARY KEY,
  transaction_id integer NOT NULL REFERENCES public.supplier_transactions(transaction_id) ON DELETE CASCADE,
  description    text          NOT NULL,   -- e.g. "SHIRTS"
  hsn_code       varchar(10),              -- e.g. "620590"
  qty            numeric(10,2) NOT NULL,
  unit           varchar(20),              -- e.g. "Pcs"
  unit_price     numeric(12,2) NOT NULL,
  amount         numeric(12,2) NOT NULL,
  -- Nullable: fill later when associating to a product
  product_id     varchar(20) REFERENCES public.products(productid) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_items_txn
  ON public.supplier_bill_line_items(transaction_id);

CREATE INDEX IF NOT EXISTS idx_supplier_bill_line_items_product
  ON public.supplier_bill_line_items(product_id);

-- ============================================================
-- 5. RLS — new tables (suppliers already has RLS from migration_rls_all_tables.sql)
-- ============================================================
ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON public.supplier_transactions USING (is_admin());

ALTER TABLE public.supplier_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON public.supplier_bills USING (is_admin());

ALTER TABLE public.supplier_bill_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_only" ON public.supplier_bill_line_items USING (is_admin());
