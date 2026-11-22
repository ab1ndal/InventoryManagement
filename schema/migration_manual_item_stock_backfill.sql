-- Backfill for schema/migration_manual_item_stock.sql: manual items already sold get the stock
-- their bills would have left them with. Run right after that migration, before the app changes
-- are merged. The figure is worked out from the bills alone, so before the merge it is the same
-- whichever of the two runs first, and a second run changes nothing. Do not run it after the
-- merge: the app then creates an item with its line's quantity as stock, not 1, so an item made
-- for 0.5 m of fabric would be set back to 0.5 here.
--
-- Every manual item reads 1 today, sold or not, because no sale ever took manual-item stock. Each
-- item is set to
--   greatest(0, 1 - held)
-- where held = the quantity on its lines (bill_items.product_code = manual_item_id, no variant)
-- of bills that took stock (not cancelled, stock_reduced not false: drafts and legacy null bills
-- count, as the owner ruled for legacy bills), less what was exchanged from those lines. 1 is
-- the column default every item was created with; nothing is taken below 0 (a piece sold twice,
-- or 3.5 m of fabric from an item that read 1, ends at 0).
-- Live preview (read-only, 2026-11-22, the same statement as a select): 197 items, all reading 1;
-- 183 go from 1 to 0, 14 unsold stay 1, no other value. The count grows as slips are entered.
--
-- One statement, so atomic on its own. Apply it as the other migrations are applied (one
-- transaction with its _migrations insert, tasks/lessons.md). No begin/commit here, so
-- schema/test_manual_item_stock_backfill.sql can run it inside its own rolled-back transaction.
-- Read-only check after (expect 0 rows):
--   select manual_item_id, stock from public.manual_items where stock not in (0, 1);

update public.manual_items m
   set stock = n.stock
  from (select mi.manual_item_id,
               greatest(0, 1 - coalesce(h.held, 0)) as stock
          from public.manual_items mi
          left join (select l.code, sum(l.qty) as held
                       from (select bi.product_code as code, bi.quantity as qty
                               from public.bill_items bi
                               join public.bills b on b.billid = bi.billid
                              where bi.variantid is null
                                and b.paymentstatus is distinct from 'cancelled'
                                and b.stock_reduced is distinct from false
                             union all
                             select bi.product_code, -e.quantity
                               from public.exchanges e
                               join public.bill_items bi on bi.bill_item_id = e.original_bill_item_id
                               join public.bills b on b.billid = bi.billid
                              where bi.variantid is null
                                and b.paymentstatus is distinct from 'cancelled'
                                and b.stock_reduced is distinct from false) l
                      group by l.code) h on h.code = mi.manual_item_id) n
 where m.manual_item_id = n.manual_item_id
   and m.stock is distinct from n.stock;
