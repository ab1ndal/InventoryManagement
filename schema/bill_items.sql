create table public.bill_items (
  bill_item_id serial not null,
  billid integer not null,
  quantity integer not null,
  mrp numeric(10, 2) not null,
  variantid uuid null,
  product_name text null,
  product_code text null,
  category text null,
  alteration_charge numeric(10, 2) null default 0,
  stitching_charge numeric(10, 2) null default 0,
  discount_total numeric(10, 2) null default 0,
  subtotal numeric(10, 2) not null,
  gst_rate numeric(5, 2) null,
  gst_amount numeric(10, 2) not null,
  total numeric(10, 2) not null,
  cost_price numeric(10, 2) null,
  constraint bill_items_pkey primary key (bill_item_id),
  constraint bill_items_billid_fkey foreign KEY (billid) references bills (billid) on delete CASCADE,
  constraint bill_items_variantid_fkey foreign KEY (variantid) references productsizecolors (variantid)
) TABLESPACE pg_default;

create index IF not exists idx_bill_items_billid on public.bill_items using btree (billid) TABLESPACE pg_default;