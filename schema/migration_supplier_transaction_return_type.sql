-- Add 'return' as a valid supplier transaction type.
-- A return (defective product sent back) is recorded as a credit, like a payment/advance.

ALTER TABLE public.supplier_transactions
  DROP CONSTRAINT IF EXISTS supplier_transactions_type_check;

ALTER TABLE public.supplier_transactions
  ADD CONSTRAINT supplier_transactions_type_check
  CHECK (type IN ('bill', 'payment', 'advance', 'return'));
