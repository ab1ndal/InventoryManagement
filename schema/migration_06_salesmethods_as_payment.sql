-- Migrate payment_method text column → salesmethods FK
-- Step 1: Ensure payment method rows exist in salesmethods
INSERT INTO salesmethods (methodname)
VALUES ('Cash'), ('Card'), ('UPI'), ('Mixed')
ON CONFLICT DO NOTHING;

-- Step 2: Backfill salesmethodid from existing payment_method text
UPDATE bills b
SET salesmethodid = sm.salesmethodid
FROM salesmethods sm
WHERE LOWER(sm.methodname) = LOWER(b.payment_method)
  AND b.payment_method IS NOT NULL;

-- Step 3: Drop payment_method column and its check constraint
ALTER TABLE bills
  DROP CONSTRAINT IF EXISTS bills_payment_method_check,
  DROP COLUMN IF EXISTS payment_method;
