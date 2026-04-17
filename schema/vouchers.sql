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