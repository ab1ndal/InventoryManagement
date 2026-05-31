-- schema/migration_monthly_sales_history.sql
-- Pre-bills monthly revenue history (legacy, manually entered).
-- FY-based: fy_start_year is the April-year of the financial year
-- (e.g. 2018 => FY 2018-19), month_idx 0 = April ... 11 = March.
-- Revenue only: no cost / category / salesperson / discount detail available,
-- so this feeds revenue-level views only.

CREATE TABLE IF NOT EXISTS monthly_sales_history (
  fy_start_year integer NOT NULL,
  month_idx     integer NOT NULL CHECK (month_idx BETWEEN 0 AND 11),
  net_amount    numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (fy_start_year, month_idx)
);

COMMENT ON TABLE monthly_sales_history IS
  'Legacy monthly revenue prior to the bills table. Revenue totals only.';

-- Data is loaded separately by the owner. Example row (do not rely on this):
-- INSERT INTO monthly_sales_history (fy_start_year, month_idx, net_amount)
-- VALUES (2018, 0, 567021)  -- FY2018-19, April
-- ON CONFLICT (fy_start_year, month_idx) DO UPDATE SET net_amount = EXCLUDED.net_amount;
