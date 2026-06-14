-- Per-line discount % and transaction-level rounding adjustment, to match
-- supplier invoice formats (e.g. "Disc. % 10%", "Rounded Off (-)0.16")
ALTER TABLE supplier_bill_line_items ADD COLUMN IF NOT EXISTS discount_pct numeric;
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS round_off_amount numeric;
