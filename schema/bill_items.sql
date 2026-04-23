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
  stitch_type text not null default 'unstitched'::text,
  salesperson_id integer null,
  constraint bill_items_pkey primary key (bill_item_id),
  constraint bill_items_billid_fkey foreign KEY (billid) references bills (billid) on delete CASCADE,
  constraint bill_items_salesperson_id_fkey foreign KEY (salesperson_id) references salespersons (salesperson_id),
  constraint bill_items_variantid_fkey foreign KEY (variantid) references productsizecolors (variantid)
) TABLESPACE pg_default;

create index IF not exists idx_bill_items_billid on public.bill_items using btree (billid) TABLESPACE pg_default;

create trigger bill_items_sync_salespersons
after INSERT
or DELETE
or
update OF salesperson_id on bill_items for EACH row
execute FUNCTION sync_bill_salesperson_ids ();