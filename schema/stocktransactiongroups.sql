create table public.stocktransactiongroups (
  transactiondate timestamp without time zone null default CURRENT_TIMESTAMP,
  transactiongroupid serial not null,
  supplierid integer null,
  note text null,
  constraint stocktransactiongroups_pkey primary key (transactiongroupid),
  constraint stocktransactiongroups_supplierid_fkey foreign KEY (supplierid) references suppliers (supplierid)
) TABLESPACE pg_default;