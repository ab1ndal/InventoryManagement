create table public.productsizecolors (
  productid character varying(20) not null,
  size character varying(20) not null,
  color character varying(50) not null,
  stock integer not null default 0,
  variantid uuid not null,
  constraint productsizecolors_pkey primary key (variantid),
  constraint unique_productid_size_color unique (productid, size, color),
  constraint productsizecolors_productid_fkey foreign KEY (productid) references products (productid) on update CASCADE on delete RESTRICT
) TABLESPACE pg_default;