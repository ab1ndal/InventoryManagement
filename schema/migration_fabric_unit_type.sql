-- Add unit_type to products: 'piece' (default) or 'meter'
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS unit_type varchar(10) NOT NULL DEFAULT 'piece';

-- Widen stock to support decimal meters
ALTER TABLE public.productsizecolors
  ALTER COLUMN stock TYPE numeric(10,3);

-- Widen stock transaction quantity
ALTER TABLE public.stocktransactions
  ALTER COLUMN quantity TYPE numeric(10,3);

-- Widen bill_items quantity and add denormalized unit_type
ALTER TABLE public.bill_items
  ALTER COLUMN quantity TYPE numeric(10,3);

ALTER TABLE public.bill_items
  ADD COLUMN IF NOT EXISTS unit_type varchar(10) NOT NULL DEFAULT 'piece';
