-- A bill line that exchange credit was given for stays on its bill as it was sold.
--
-- Exchange credit is tied to the line it came from by exchanges.original_bill_item_id, and
-- bill_cancel and bill_edit find what credit a bill already gave out through that link. The live
-- foreign key is ON DELETE SET NULL, so deleting the line (the bill screen used to delete and
-- re-insert every line on each edit) silently dropped the link: the bill then looked as if no
-- credit had come out of it, and bill_edit paid the same value back again as a refund or store
-- credit (2026-11-12 verifier, "Hole A"). Lowering the line's quantity under what was exchanged,
-- or swapping its product or price, has the same effect without dropping the link.
--
-- So, for a line with any exchanges row (in-store exchange, or an online refund offset):
--   - it cannot be deleted, on its own or with its bill (BILL_ITEM_EXCHANGED);
--   - its bill, variant and MRP cannot change, and its quantity cannot go below the exchanged
--     quantity (BILL_ITEM_EXCHANGED). Discount, salesperson and the other columns stay editable.
-- Lines with no exchange are untouched. bill_cancel never deletes or changes lines, and
-- exchange_record only inserts exchanges rows, so neither is affected.
--
-- Rejected: changing the foreign key to ON DELETE RESTRICT. It would also stop deletes, but with
-- a bare 23503 instead of a named refusal, and it would not cover quantity, variant or price.
-- The trigger fires before the foreign key's SET NULL, so the key can stay as it is.
--
-- A future variant-merge migration (like migration_color_semantic.sql, which rewrote
-- bill_items.variantid) must disable trg_bill_items_exchange_lock for its own statement.
--
-- Run after schema/migration_bill_payments_ledger.sql. Read-only check first: lines whose
-- exchanges already lost their link (the trigger cannot bring those back).
--   select count(*) from public.exchanges where original_bill_item_id is null;

set local lock_timeout = '3s';

-- Security definer so row security on exchanges cannot hide a line's exchange from the check.
create or replace function public._bill_items_exchange_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exchanged numeric;
begin
  select sum(e.quantity) into v_exchanged
    from public.exchanges e where e.original_bill_item_id = old.bill_item_id;
  if v_exchanged is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'BILL_ITEM_EXCHANGED' using errcode = 'P0001',
      detail = format('bill item %s on bill %s has %s exchanged; it cannot be removed',
                      old.bill_item_id, old.billid, trim_scale(v_exchanged));
  end if;

  if new.billid is distinct from old.billid or new.variantid is distinct from old.variantid
     or new.mrp is distinct from old.mrp or new.quantity < v_exchanged then
    raise exception 'BILL_ITEM_EXCHANGED' using errcode = 'P0001',
      detail = format('bill item %s on bill %s has %s exchanged; its bill, variant and MRP stay, '
                      'and its quantity cannot go below that', old.bill_item_id, old.billid,
                      trim_scale(v_exchanged));
  end if;
  return new;
end;
$$;
revoke all on function public._bill_items_exchange_lock() from public, anon, authenticated;

drop trigger if exists trg_bill_items_exchange_lock on public.bill_items;
create trigger trg_bill_items_exchange_lock
  before update or delete on public.bill_items
  for each row execute function public._bill_items_exchange_lock();
