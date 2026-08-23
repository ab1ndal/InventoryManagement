-- bills.payment_amount now holds the TOTAL received for a bill, not just the first
-- installment. Multi-payment bills previously left it at the first payment while the
-- true total lived only in bill_payments, so readers had to know which convention
-- applied to which bill (see BillTable amount_received).
--
-- BillingForm.handleAddPayment keeps it in step from here on; this backfills the bills
-- recorded under the old convention. bill_payments stays the ledger of record.

UPDATE bills b
SET payment_amount = p.paid
FROM (
  SELECT billid, ROUND(SUM(amount)::numeric, 2) AS paid
  FROM bill_payments
  GROUP BY billid
) p
WHERE b.billid = p.billid
  AND (b.payment_amount IS NULL OR ABS(b.payment_amount - p.paid) > 0.005);
