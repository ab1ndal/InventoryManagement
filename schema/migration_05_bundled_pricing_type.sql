-- migration_05_bundled_pricing_type.sql
-- PURPOSE: Add 'bundled_pricing' to the discounts type CHECK constraint.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query).

ALTER TABLE public.discounts
  DROP CONSTRAINT IF EXISTS discounts_type_check;

ALTER TABLE public.discounts
  ADD CONSTRAINT discounts_type_check CHECK (
    type = ANY (ARRAY[
      'flat'::text,
      'percentage'::text,
      'buy_x_get_y'::text,
      'fixed_price'::text,
      'conditional'::text,
      'bundled_pricing'::text
    ])
  );
