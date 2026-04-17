create table public.saleslocations (
  saleslocationid serial not null,
  locationname character varying(50) not null,
  constraint saleslocations_pkey primary key (saleslocationid)
) TABLESPACE pg_default;