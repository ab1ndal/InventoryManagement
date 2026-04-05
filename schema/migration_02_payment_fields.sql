-- Phase 2: Add payment_method and payment_amount columns to bills table (D-11 / SCHEMA-01)
-- Run manually in Supabase SQL Editor

ALTER TABLE public.bills ADD COLUMN payment_method text CHECK (payment_method IN ('cash','card','upi','mixed'));
ALTER TABLE public.bills ADD COLUMN payment_amount numeric(10,2);
