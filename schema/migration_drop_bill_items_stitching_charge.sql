-- Merge stitching_charge into alteration_charge.
--
-- stitching_charge was a legacy alias for alteration_charge. All active billing
-- code wrote only alteration_charge and read stitching_charge merely as a dead
-- `alteration_charge || stitching_charge` fallback. The column was never
-- populated on bill_items (0 rows > 0), so this drop loses no data. The
-- fallbacks and the only writer (unrouted archive/BillForm.js) have been removed
-- from the client in the same change. Backup tables keep their own copies.

ALTER TABLE bill_items DROP COLUMN IF EXISTS stitching_charge;
