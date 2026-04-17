-- Add gst_off to discounts_type_check constraint
ALTER TABLE public.discounts
  DROP CONSTRAINT discounts_type_check;

ALTER TABLE public.discounts
  ADD CONSTRAINT discounts_type_check CHECK (
    type = ANY (ARRAY[
      'flat'::text,
      'percentage'::text,
      'buy_x_get_y'::text,
      'fixed_price'::text,
      'conditional'::text,
      'bundled_pricing'::text,
      'gst_off'::text
    ])
  );
