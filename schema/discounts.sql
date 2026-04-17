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
          'conditional'::text,
          'bundled_pricing'::text,
          'gst_off'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;