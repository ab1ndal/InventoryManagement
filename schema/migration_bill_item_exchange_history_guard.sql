-- Never erase the link between an exchange credit and the sold line that funded it.
--
-- The bill screen currently edits items by deleting every bill_items row and inserting the
-- replacement rows.  exchanges.original_bill_item_id uses ON DELETE SET NULL so the exchange
-- record survives, but after the delete there is no trustworthy way for bill_edit to know that
-- the removed value was already paid out as exchange credit.  It could then refund or credit the
-- same value a second time.
--
-- Until item editing is moved into one database transaction with stable line identities, refuse
-- deletion of any line with exchange history.  The whole client edit consequently fails before
-- it changes items, stock, the bill, payments or store credit.

set local lock_timeout = '3s';

create or replace function public._bill_item_keep_exchange_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.exchanges e where e.original_bill_item_id = old.bill_item_id
  ) then
    raise exception 'BILL_ITEM_EXCHANGED' using errcode = 'P0001',
      detail = format('bill item %s has exchange history and cannot be replaced', old.bill_item_id);
  end if;
  return old;
end;
$$;

drop trigger if exists bill_item_keep_exchange_history on public.bill_items;
create trigger bill_item_keep_exchange_history
before delete on public.bill_items
for each row execute function public._bill_item_keep_exchange_history();

revoke all on function public._bill_item_keep_exchange_history() from public, anon, authenticated;

