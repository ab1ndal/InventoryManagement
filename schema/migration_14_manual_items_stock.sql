-- Migration 14: add stock column to manual_items (Phase 6 D-19)
-- Manual items are returnable in the exchange flow; restock increments this column.
ALTER TABLE public.manual_items
  ADD COLUMN IF NOT EXISTS stock integer NOT NULL DEFAULT 1;
