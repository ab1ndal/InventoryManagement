-- Phase 1: Add applied_codes to bills table for discount code persistence (D-02)
ALTER TABLE public.bills ADD COLUMN applied_codes text[] DEFAULT '{}';
