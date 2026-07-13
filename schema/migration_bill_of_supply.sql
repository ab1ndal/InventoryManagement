-- Bill of Supply (Phase 1): per-bill document type + independent number series.
-- BoS keeps the existing FY{YY}-NNNNNN series; tax invoices get FY{YY}-SGNNNN.

BEGIN;

-- 1. Discriminator on bills. Default 'bos' — new bills are Bills of Supply.
ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'bos'
  CHECK (document_type IN ('invoice', 'bos'));

-- 2. Sequence table keyed by (financial_year, document_type).
--    Existing rows are the BoS series (all historical bills are BoS).
ALTER TABLE public.bill_sequences
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'bos';

ALTER TABLE public.bill_sequences
  DROP CONSTRAINT IF EXISTS bill_sequences_pkey;
ALTER TABLE public.bill_sequences
  ADD CONSTRAINT bill_sequences_pkey PRIMARY KEY (financial_year, document_type);

-- 3. Rewrite the number-assignment trigger to branch on document_type.
CREATE OR REPLACE FUNCTION public.set_bill_number()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_date DATE;
  v_fy   TEXT;
  v_seq  INTEGER;
  v_type TEXT;
BEGIN
  IF NEW.bill_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(NEW.document_type, 'bos');
  v_date := COALESCE(NEW.orderdate::DATE, CURRENT_DATE);

  -- Indian FY: Apr–Mar → label by start year (Apr 2026–Mar 2027 = "26")
  IF EXTRACT(MONTH FROM v_date) >= 4 THEN
    v_fy := TO_CHAR(v_date, 'YY');
  ELSE
    v_fy := TO_CHAR(v_date - INTERVAL '1 year', 'YY');
  END IF;

  INSERT INTO bill_sequences (financial_year, document_type, last_value)
  VALUES (v_fy, v_type, 1)
  ON CONFLICT (financial_year, document_type) DO UPDATE
    SET last_value = bill_sequences.last_value + 1
  RETURNING last_value INTO v_seq;

  IF v_type = 'invoice' THEN
    NEW.bill_number := 'FY' || v_fy || '-SG' || LPAD(v_seq::TEXT, 4, '0');
  ELSE
    NEW.bill_number := 'FY' || v_fy || '-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;

  RETURN NEW;
END;
$function$;

-- 4. Drop the dead, un-namespaced legacy numbering function (collision hazard).
DROP FUNCTION IF EXISTS public.generate_bill_number();

COMMIT;
