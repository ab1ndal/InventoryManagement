-- Merge standalone letter sizes and standalone chest-inch sizes into unified pipe codes.
-- S + 36 + S|36 → S|36 (single canonical code per size equivalence group)

UPDATE productsizecolors SET size = 'S|36'   WHERE size IN ('S',  '36');
UPDATE productsizecolors SET size = 'M|38'   WHERE size IN ('M',  '38');
UPDATE productsizecolors SET size = 'L|40'   WHERE size IN ('L',  '40');
UPDATE productsizecolors SET size = 'XL|42'  WHERE size IN ('XL', '42');
UPDATE productsizecolors SET size = '2XL|44' WHERE size IN ('2XL','44');

-- Remove now-orphaned standalone codes from the reference table
DELETE FROM sizes WHERE code IN ('S', 'M', 'L', 'XL', '2XL', '36', '38', '40', '42', '44');

-- Verify: should return 0 rows
-- SELECT DISTINCT size FROM productsizecolors WHERE size NOT IN (SELECT code FROM sizes) ORDER BY size;
