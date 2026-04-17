create table public.exchanges (
  exchangeid serial not null,
  original_bill_item_id integer not null,
  returndate timestamp without time zone null default CURRENT_TIMESTAMP,
  quantity integer not null,
  reason text null,
  customerid integer null,
  credit_amount numeric(10, 2) not null default 0,
  voucher_id text null,
  constraint returns_pkey primary key (exchangeid),
  constraint exchanges_customerid_fkey foreign KEY (customerid) references customers (customerid),
  constraint exchanges_voucher_id_fkey foreign KEY (voucher_id) references vouchers (voucher_id),
  constraint returns_billitemid_fkey foreign KEY (original_bill_item_id) references bill_items (bill_item_id) on delete CASCADE
) TABLESPACE pg_default;