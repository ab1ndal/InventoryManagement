-- Problem: exchanges.original_bill_item_id had ON DELETE CASCADE -> bill_items.
-- Editing a source bill deletes + reinserts its bill_items (new ids), which
-- cascade-deletes the exchange records that tracked credit issued from those
-- items. This destroys credit history and the per-item breakdown shown on the
-- redeeming bill.
--
-- Fix: snapshot the display fields onto the exchange row, make the FK column
-- nullable, and switch CASCADE -> SET NULL so exchange records survive a
-- source-bill edit (the link is cleared, the record and its snapshot remain).

alter table exchanges add column if not exists product_name text;
alter table exchanges add column if not exists product_code text;

-- Backfill snapshots from still-linked bill_items
update exchanges e
set product_name = bi.product_name,
    product_code = bi.product_code
from bill_items bi
where e.original_bill_item_id = bi.bill_item_id
  and (e.product_name is null or e.product_code is null);

-- Allow the link to be cleared instead of cascade-deleting the whole row
alter table exchanges alter column original_bill_item_id drop not null;

alter table exchanges drop constraint if exists returns_billitemid_fkey;
alter table exchanges add constraint returns_billitemid_fkey
  foreign key (original_bill_item_id) references bill_items (bill_item_id) on delete set null;
