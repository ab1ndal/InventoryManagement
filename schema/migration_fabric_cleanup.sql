-- Migration: Clean up fabric spelling inconsistencies in products table
-- Run in Supabase dashboard SQL editor
-- Phase 1 of 2: spelling normalization only (groupings handled separately)

-- Step 1: trim all leading/trailing whitespace
UPDATE public.products SET fabric = TRIM(fabric) WHERE fabric != TRIM(fabric);

-- Step 2: case normalization (exact duplicates differing only in case/whitespace)
UPDATE public.products SET fabric = 'Silk'              WHERE fabric = 'SIlk';
UPDATE public.products SET fabric = 'Sweety Chiffon'    WHERE fabric IN ('Sweetly chiffon', 'Sweetly chiffonn');

-- Step 3: spelling typos (clear-cut)
UPDATE public.products SET fabric = 'Banarasi Silk'     WHERE fabric = 'Banarsi Silk';
UPDATE public.products SET fabric = 'Organza'           WHERE fabric = 'Oragnza';
UPDATE public.products SET fabric = 'Brasso'            WHERE fabric = 'Braso';
UPDATE public.products SET fabric = 'Cotton Silk'       WHERE fabric IN ('Cotton silk', 'Cotton-Silk');
UPDATE public.products SET fabric = 'Cotton Self'       WHERE fabric = 'Cotton_self';
UPDATE public.products SET fabric = 'Dola Silk'         WHERE fabric = 'Dola silk';
UPDATE public.products SET fabric = 'Jacquard Silk'     WHERE fabric = 'Jacquard silk';
UPDATE public.products SET fabric = 'Silk Net'          WHERE fabric = 'Silk net';
UPDATE public.products SET fabric = 'Satin Silk'        WHERE fabric = 'Sattan Silk';
UPDATE public.products SET fabric = 'Sambhalpuri Cotton' WHERE fabric = 'Sambhalpuri cotton';
UPDATE public.products SET fabric = 'Rayon Cotton'      WHERE fabric = 'Reyon cotton';
UPDATE public.products SET fabric = 'Satan Crape'       WHERE fabric = 'Satan crape';

-- Step 4: verify — run this SELECT after to confirm no unexpected values remain
-- SELECT fabric, COUNT(*) AS cnt FROM public.products GROUP BY fabric ORDER BY fabric;

-- ============================================================
-- CONFIRM BEFORE RUNNING — likely typos needing human review:
-- ============================================================
UPDATE public.products SET fabric = 'Velvet'  WHERE fabric = 'Belbet';       -- 8 rows
UPDATE public.products SET fabric = 'Brocade' WHERE fabric = 'Brocket';      -- 2 rows
UPDATE public.products SET fabric = 'Lycra'   WHERE fabric = 'Licra';        -- 39 rows
UPDATE public.products SET fabric = 'Lycra Cotton' WHERE fabric = 'Licra Cotton'; -- 3 rows
UPDATE public.products SET fabric = 'Satin'        WHERE fabric = 'Satan';        -- 13 rows
UPDATE public.products SET fabric = 'Satin Cotton' WHERE fabric = 'Satan Cotton'; -- 24 rows
UPDATE public.products SET fabric = 'Satin Crape'  WHERE fabric = 'Satan Crape';  -- 3 rows
UPDATE public.products SET fabric = 'Satin Net'    WHERE fabric = 'Satan Net';    -- 11 rows
UPDATE public.products SET fabric = 'Satin Silk'   WHERE fabric = 'Satan Silk';   -- 29 rows
UPDATE public.products SET fabric = 'Rayon Georgette' WHERE fabric = 'Georgette_reyon'; -- 1 row
