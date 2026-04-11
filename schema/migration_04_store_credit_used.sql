-- Phase 4 Gap Closure: Persist the store credit consumed on each bill so cancels can refund it (gap 2)
-- Run manually in Supabase SQL Editor.

ALTER TABLE public.bills
  ADD COLUMN store_credit_used numeric(10,2) NOT NULL DEFAULT 0;
