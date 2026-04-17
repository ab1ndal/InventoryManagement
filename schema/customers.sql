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
  loyalty_tier character varying(10) null,
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

create index IF not exists idx_customers_email on public.customers using btree (email) TABLESPACE pg_default;

create index IF not exists idx_customers_ulid on public.customers using btree (customer_ulid) TABLESPACE pg_default;