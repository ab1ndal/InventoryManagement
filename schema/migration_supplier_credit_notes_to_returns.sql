-- One-off data fix for supplier_id 2 (credit notes mis-entered as bills).
-- Each CN/26-27 credit note was recorded as a detailed Bill (debit) plus a
-- plain offsetting Return (credit), netting to zero. Correct treatment: the
-- credit note is a single detailed Return (credit), reducing the balance.
--
-- Convert the detailed CN bills -> return (keeps invoice / GST / line items /
-- documents already attached to the transaction; only the debit/credit sign
-- flips). Then delete the now-redundant plain offset returns.

UPDATE public.supplier_transactions
  SET type = 'return'
  WHERE transaction_id IN (2, 3, 4, 5, 6)
    AND type = 'bill'
    AND invoice_number LIKE 'CN/%';

DELETE FROM public.supplier_transactions
  WHERE transaction_id IN (39, 40, 41, 42, 44)
    AND type = 'return'
    AND invoice_number IS NULL;
