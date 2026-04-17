create table public.suppliers (
  supplierid serial not null,
  name character varying(100) not null,
  phone character varying(20) null,
  email character varying(100) null,
  notes text null,
  constraint suppliers_pkey primary key (supplierid)
) TABLESPACE pg_default;