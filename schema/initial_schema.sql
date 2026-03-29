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
  constraint bill_items_pkey primary key (bill_item_id),
  constraint bill_items_billid_fkey foreign KEY (billid) references bills (billid) on delete CASCADE,
  constraint bill_items_variantid_fkey foreign KEY (variantid) references productsizecolors (variantid)
) TABLESPACE pg_default;

create index IF not exists idx_bill_items_billid on public.bill_items using btree (billid) TABLESPACE pg_default;

create table public.bills (
  billid serial not null,
  customerid integer null,
  orderdate timestamp without time zone null default CURRENT_TIMESTAMP,
  totalamount numeric(10, 2) null,
  paymentstatus character varying(20) null,
  saleslocationid integer null,
  salesmethodid integer null,
  notes text null,
  gst_total numeric(10, 2) null,
  discount_total numeric(10, 2) null,
  taxable_total numeric(10, 2) null,
  pdf_url text null,
  finalized boolean null default false,
  constraint orders_pkey primary key (billid),
  constraint orders_customerid_fkey foreign KEY (customerid) references customers (customerid),
  constraint orders_saleslocationid_fkey foreign KEY (saleslocationid) references saleslocations (saleslocationid),
  constraint orders_salesmethodid_fkey foreign KEY (salesmethodid) references salesmethods (salesmethodid)
) TABLESPACE pg_default;

create table public.categories (
  categoryid character varying(10) not null,
  name character varying(50) not null,
  description text null,
  constraint categories_pkey primary key (categoryid)
) TABLESPACE pg_default;

create table public.customers (
  customerid serial not null,
  phone character varying(20) null,
  email character varying(100) null,
  address text null,
  created_at timestamp without time zone null default CURRENT_TIMESTAMP,
  customer_ulid character varying(26) not null,
  first_name character varying(50) not null,
  last_name character varying(50) not null,
  gender character varying(20) null,
  total_spend numeric(12, 2) null default 0,
  loyalty_tier character varying(10) null,
  last_purchased_at date null,
  customer_notes text null,
  referred_by integer null,
  store_credit double precision null default '0'::double precision,
  constraint customers_pkey primary key (customerid),
  constraint customers_customer_ulid_key unique (customer_ulid),
  constraint fk_referred_by foreign KEY (referred_by) references customers (customerid) on delete set null,
  constraint chk_phone_format check (((phone)::text ~ '^\+\d{10,15}$'::text)),
  constraint chk_ulid_length check ((char_length((customer_ulid)::text) = 26)),
  constraint customers_store_credit_check check ((store_credit >= (0)::double precision))
) TABLESPACE pg_default;

create unique INDEX IF not exists idx_unique_customer_phone on public.customers using btree (phone) TABLESPACE pg_default;

create index IF not exists idx_customers_phone on public.customers using btree (phone) TABLESPACE pg_default;

create index IF not exists idx_customers_email on public.customers using btree (email) TABLESPACE pg_default;

create index IF not exists idx_customers_ulid on public.customers using btree (customer_ulid) TABLESPACE pg_default;

create table public.discount_usage (
  id bigint generated always as identity not null,
  customerid integer not null,
  code text null,
  used_at timestamp without time zone null default CURRENT_TIMESTAMP,
  billid integer null,
  constraint discount_usage_pkey primary key (id),
  constraint discount_usage_billid_fkey foreign KEY (billid) references bills (billid) on delete set null,
  constraint discount_usage_code_fkey foreign KEY (code) references discounts (code) on delete CASCADE,
  constraint discount_usage_customerid_fkey foreign KEY (customerid) references customers (customerid) on delete CASCADE
) TABLESPACE pg_default;

create table public.discounts (
  id bigint generated always as identity not null,
  code text null,
  type text not null,
  value numeric null,
  max_discount numeric null,
  category text null,
  product_ids text[] null,
  once_per_customer boolean null default false,
  exclusive boolean null default false,
  auto_apply boolean null default false,
  min_total numeric null default 0,
  start_date timestamp without time zone null,
  end_date timestamp without time zone null,
  rules jsonb null,
  active boolean null default true,
  created_at timestamp without time zone null default CURRENT_TIMESTAMP,
  constraint discounts_pkey primary key (id),
  constraint discounts_code_key unique (code),
  constraint discounts_type_check check (
    (
      type = any (
        array[
          'flat'::text,
          'percentage'::text,
          'buy_x_get_y'::text,
          'fixed_price'::text,
          'conditional'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create table public.exchanges (
  exchangeid serial not null,
  original_bill_item_id integer not null,
  returndate timestamp without time zone null default CURRENT_TIMESTAMP,
  quantity integer not null,
  reason text null,
  customerid integer null,
  credit_amount numeric(10, 2) not null default 0,
  voucher_id text null,
  constraint returns_pkey primary key (exchangeid),
  constraint exchanges_customerid_fkey foreign KEY (customerid) references customers (customerid),
  constraint exchanges_voucher_id_fkey foreign KEY (voucher_id) references vouchers (voucher_id),
  constraint returns_billitemid_fkey foreign KEY (original_bill_item_id) references bill_items (bill_item_id) on delete CASCADE
) TABLESPACE pg_default;

create table public.mockups (
  productid character varying(20) not null,
  redo boolean null default false,
  base_mockup boolean null default false,
  file_mockup boolean null default false,
  mockup boolean null default false,
  ig_reel boolean null default false,
  ig_post boolean null default false,
  video boolean null default false,
  whatsapp boolean null default false,
  ig_post_date timestamp without time zone null,
  whatsapp_post_date timestamp without time zone null,
  constraint mockups_pkey primary key (productid),
  constraint mockups_productid_fkey foreign KEY (productid) references products (productid)
) TABLESPACE pg_default;

create table public.productimages (
  imageid serial not null,
  productid character varying(20) not null,
  imageurl text not null,
  caption text null,
  displayorder integer null default 0,
  constraint productimages_pkey primary key (imageid),
  constraint productimages_productid_fkey foreign KEY (productid) references products (productid) on update CASCADE on delete RESTRICT
) TABLESPACE pg_default;

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

create table public.productsizecolors (
  productid character varying(20) not null,
  size character varying(20) not null,
  color character varying(50) not null,
  stock integer not null default 0,
  variantid uuid not null,
  constraint productsizecolors_pkey primary key (variantid),
  constraint unique_productid_size_color unique (productid, size, color),
  constraint unique_variantid unique (variantid),
  constraint productsizecolors_productid_fkey foreign KEY (productid) references products (productid) on update CASCADE on delete RESTRICT
) TABLESPACE pg_default;

create table public.profiles (
  id uuid not null,
  email text not null default '''abc@example.com''::text'::text,
  role text null default 'user'::text,
  created_at timestamp with time zone null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_email_key unique (email)
) TABLESPACE pg_default;

create table public.saleslocations (
  saleslocationid serial not null,
  locationname character varying(50) not null,
  constraint saleslocations_pkey primary key (saleslocationid)
) TABLESPACE pg_default;

create table public.salesmethods (
  salesmethodid serial not null,
  methodname character varying(50) not null,
  constraint salesmethods_pkey primary key (salesmethodid)
) TABLESPACE pg_default;

create table public.stocktransactiongroups (
  transactiondate timestamp without time zone null default CURRENT_TIMESTAMP,
  transactiongroupid serial not null,
  supplierid integer null,
  note text null,
  constraint stocktransactiongroups_pkey primary key (transactiongroupid),
  constraint stocktransactiongroups_supplierid_fkey foreign KEY (supplierid) references suppliers (supplierid)
) TABLESPACE pg_default;

create table public.stocktransactions (
  transactionid integer not null,
  productid character varying(20) not null,
  size character varying(20) not null,
  color character varying(50) not null,
  type character varying(10) not null,
  quantity integer not null,
  note text null,
  transactiongroupid integer null,
  variantid uuid not null,
  constraint stocktransactions_pkey primary key (transactionid, variantid),
  constraint stocktransactions_transactiongroupid_fkey foreign KEY (transactiongroupid) references stocktransactiongroups (transactiongroupid),
  constraint stocktransactions_variantid_fkey foreign KEY (variantid) references productsizecolors (variantid)
) TABLESPACE pg_default;

create table public.suppliers (
  supplierid serial not null,
  name character varying(100) not null,
  phone character varying(20) null,
  email character varying(100) null,
  notes text null,
  constraint suppliers_pkey primary key (supplierid)
) TABLESPACE pg_default;

create table public.vouchers (
  voucher_id text not null,
  customerid integer null,
  issue_date date null default CURRENT_DATE,
  expiry_date date not null,
  value numeric(10, 2) not null,
  redeemed boolean null default false,
  redeemed_at timestamp without time zone null,
  redeemed_billid integer null,
  note text null,
  source text null default 'manual'::text,
  constraint vouchers_pkey primary key (voucher_id),
  constraint vouchers_customerid_fkey foreign KEY (customerid) references customers (customerid),
  constraint vouchers_redeemed_billid_fkey foreign KEY (redeemed_billid) references bills (billid),
  constraint vouchers_source_check check (
    (
      source = any (
        array['exchange'::text, 'manual'::text, 'promo'::text]
      )
    )
  )
) TABLESPACE pg_default;