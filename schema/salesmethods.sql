create table public.salesmethods (
  salesmethodid serial not null,
  methodname character varying(50) not null,
  constraint salesmethods_pkey primary key (salesmethodid)
) TABLESPACE pg_default;