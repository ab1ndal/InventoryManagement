create table public.manual_items (
  manual_item_id character varying(20) not null,
  name character varying(100) not null,
  categoryid character varying(10) null,
  size character varying(20) null,
  color character varying(50) null,
  purchase_price numeric(10, 2) null default 0,
  mrp numeric(10, 2) null default 0,
  created_at timestamp without time zone null default CURRENT_TIMESTAMP,
  constraint manual_items_pkey primary key (manual_item_id),
  constraint manual_items_categoryid_fkey foreign KEY (categoryid) references categories (categoryid)
) TABLESPACE pg_default;