-- schema/migration_bill_payments.sql
-- Stores individual payment installments for a bill.
-- bills.payment_amount stays for backward-compat with pre-feature finalized bills.

CREATE TABLE public.bill_payments (
  payment_id    serial PRIMARY KEY,
  billid        integer NOT NULL REFERENCES bills(billid) ON DELETE CASCADE,
  amount        numeric(10,2) NOT NULL CHECK (amount > 0),
  salesmethodid integer NOT NULL REFERENCES salesmethods(salesmethodid),
  recorded_at   timestamp WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes         text
);

CREATE INDEX idx_bill_payments_billid ON public.bill_payments(billid);
