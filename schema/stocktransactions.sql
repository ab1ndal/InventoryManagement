create table public.stocktransactions (
  transactionid integer not null,
  productid character varying(20) not null,
  size character varying(20) not null,
  color character varying(50) not null,
  type character varying(10) not null,
  quantity integer not null,
  note text null,
  transactiongroupid integer null,
  variantid uuid not null,
  constraint stocktransactions_pkey primary key (transactionid, variantid),
  constraint stocktransactions_transactiongroupid_fkey foreign KEY (transactiongroupid) references stocktransactiongroups (transactiongroupid),
  constraint stocktransactions_variantid_fkey foreign KEY (variantid) references productsizecolors (variantid)
) TABLESPACE pg_default;