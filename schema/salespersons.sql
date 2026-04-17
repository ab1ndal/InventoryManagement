create table public.salespersons (
  salesperson_id serial not null,
  name text not null,
  date_hired date null,
  active boolean null default true,
  constraint salespersons_pkey primary key (salesperson_id)
) TABLESPACE pg_default;