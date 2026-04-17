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