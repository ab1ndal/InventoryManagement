create table public.bill_salespersons (
  billid integer not null,
  salesperson_id integer not null,
  constraint bill_salespersons_pkey primary key (billid, salesperson_id),
  constraint bill_salespersons_billid_fkey foreign KEY (billid) references bills (billid) on delete CASCADE,
  constraint bill_salespersons_salesperson_id_fkey foreign KEY (salesperson_id) references salespersons (salesperson_id)
) TABLESPACE pg_default;