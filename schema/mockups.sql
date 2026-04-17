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