create table public.products (
  productid character varying(20) not null,
  name character varying(100) not null,
  description text null,
  categoryid character varying(10) null,
  fabric character varying(50) null,
  purchaseprice numeric(10, 2) not null,
  retailprice numeric(10, 2) not null,
  producturl text null,
  constraint products_pkey primary key (productid),
  constraint products_categoryid_fkey foreign KEY (categoryid) references categories (categoryid)
) TABLESPACE pg_default;

create index IF not exists products_productid_like_idx on public.products using btree (productid text_pattern_ops) TABLESPACE pg_default;

create trigger trg_create_mockup_row
after INSERT on products for EACH row
execute FUNCTION create_mockup_row ();