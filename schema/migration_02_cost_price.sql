-- Phase 2: Add cost_price column to bill_items table for Z Code / profit tracking (D-13)
-- Run manually in Supabase SQL Editor

ALTER TABLE public.bill_items ADD COLUMN cost_price numeric(10,2);
