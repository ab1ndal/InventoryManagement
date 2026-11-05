-- Whether saving a bill reduced stock, so Cancel and Delete restore only what really left.
-- Bills saved before this stay null: nobody recorded the "Don't reduce stock" choice, so staff decide
-- when cancelling one. The default is set after adding the column so those rows are not marked true.
-- Writers other than the bill form (admin CLI, online orders, bill_save) always reduce stock.

alter table public.bills add column if not exists stock_reduced boolean;
alter table public.bills alter column stock_reduced set default true;
