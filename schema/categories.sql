create table public.categories (
  categoryid character varying(10) not null,
  name character varying(50) not null,
  description text null,
  constraint categories_pkey primary key (categoryid)
) TABLESPACE pg_default;