create table public.productimages (
  imageid serial not null,
  productid character varying(20) not null,
  imageurl text not null,
  caption text null,
  displayorder integer null default 0,
  constraint productimages_pkey primary key (imageid),
  constraint productimages_productid_fkey foreign KEY (productid) references products (productid) on update CASCADE on delete RESTRICT
) TABLESPACE pg_default;