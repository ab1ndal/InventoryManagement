-- GENERATED from live DB catalog on 2026-10-23 (schema only, no data) for local tests.
-- Regenerate when the live schema of these tables changes (see scripts/test-db.sh).
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz, phone text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create sequence if not exists customers_customerid_seq;
create sequence if not exists orderitems_orderitemid_seq;
create sequence if not exists orders_orderid_seq;
create sequence if not exists returns_returnid_seq;
create sequence if not exists saleslocations_saleslocationid_seq;
create sequence if not exists salesmethods_salesmethodid_seq;

create table if not exists public.bill_items (
  bill_item_id integer default nextval('orderitems_orderitemid_seq'::regclass) not null,
  billid integer not null,
  quantity numeric(10,3) not null,
  mrp numeric(10,2) not null,
  variantid uuid,
  product_name text,
  product_code text,
  category text,
  alteration_charge numeric(10,2) default 0,
  discount_total numeric(10,2) default 0,
  subtotal numeric(10,2) not null,
  gst_rate numeric(5,2),
  gst_amount numeric(10,2) not null,
  total numeric(10,2) not null,
  cost_price numeric(10,2),
  stitch_type text default 'unstitched'::text not null,
  salesperson_id integer,
  unit_type character varying(10) default 'piece'::character varying not null
);
create table if not exists public.bill_sequences (
  financial_year text not null,
  last_value integer not null,
  document_type text default 'bos'::text not null
);
create table if not exists public.bills (
  billid integer default nextval('orders_orderid_seq'::regclass) not null,
  customerid integer,
  orderdate timestamp without time zone default CURRENT_TIMESTAMP,
  totalamount numeric(10,2),
  paymentstatus character varying(20),
  saleslocationid integer,
  salesmethodid integer,
  notes text,
  gst_total numeric(10,2),
  discount_total numeric(10,2),
  taxable_total numeric(10,2),
  pdf_url text,
  finalized boolean default false,
  applied_codes text[] default '{}'::text[],
  payment_amount numeric(10,2),
  net_amount numeric(10,2),
  store_credit_used numeric(10,2) default 0 not null,
  bill_number text,
  salesperson_ids integer[],
  exchange_credit_used numeric(10,2) default 0 not null,
  exchange_source_bill text,
  final_amount numeric(10,2),
  exchange_cash_refund numeric(10,2) default 0 not null,
  document_type text default 'bos'::text not null
);
create table if not exists public.cart_items (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  variant_id uuid not null,
  product_id text not null,
  quantity integer not null,
  added_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create table if not exists public.categories (
  categoryid character varying(10) not null,
  name character varying(50) not null,
  description text
);
create table if not exists public.customers (
  customerid integer default nextval('customers_customerid_seq'::regclass) not null,
  phone character varying(20),
  email character varying(100),
  address text,
  created_at timestamp without time zone default CURRENT_TIMESTAMP,
  customer_ulid character varying(26) not null,
  first_name character varying(50) not null,
  last_name character varying(50),
  gender character varying(20),
  loyalty_tier character varying(10),
  customer_notes text,
  referred_by integer,
  store_credit double precision default '0'::double precision,
  is_guest boolean default false,
  auth_user_id uuid,
  marketing_opt_in boolean default false not null,
  community_status text default 'not_added'::text not null,
  community_status_at timestamp with time zone
);
create table if not exists public.discount_usage (
  id bigint generated always as identity not null,
  customerid integer not null,
  code text,
  used_at timestamp without time zone default CURRENT_TIMESTAMP,
  billid integer
);
create table if not exists public.discounts (
  id bigint generated always as identity not null,
  code text,
  type text not null,
  value numeric,
  max_discount numeric,
  category text,
  product_ids text[],
  once_per_customer boolean default false,
  exclusive boolean default false,
  auto_apply boolean default false,
  min_total numeric default 0,
  start_date timestamp without time zone,
  end_date timestamp without time zone,
  rules jsonb,
  active boolean default true,
  created_at timestamp without time zone default CURRENT_TIMESTAMP
);
create table if not exists public.exchanges (
  exchangeid integer default nextval('returns_returnid_seq'::regclass) not null,
  original_bill_item_id integer,
  returndate timestamp without time zone default CURRENT_TIMESTAMP,
  quantity integer not null,
  reason text,
  customerid integer,
  credit_amount numeric(10,2) default 0 not null,
  voucher_id text,
  new_billid integer,
  product_name text,
  product_code text
);
create table if not exists public.products (
  productid character varying(20) not null,
  name character varying(100) not null,
  description text,
  categoryid character varying(10),
  fabric character varying(50),
  purchaseprice numeric(10,2) not null,
  retailprice numeric(10,2) not null,
  producturl text,
  unit_type character varying(10) default 'piece'::character varying not null
);
create table if not exists public.productsizecolors (
  productid character varying(20) not null,
  size character varying(20) not null,
  color character varying(50) not null,
  stock numeric(10,3) default 0 not null,
  variantid uuid not null
);
create table if not exists public.profiles (
  id uuid not null,
  email text default '''abc@example.com''::text'::text not null,
  role text default 'user'::text,
  created_at timestamp with time zone default now(),
  is_active boolean default false not null
);
create table if not exists public.saleslocations (
  saleslocationid integer default nextval('saleslocations_saleslocationid_seq'::regclass) not null,
  locationname character varying(50) not null
);
create table if not exists public.salesmethods (
  salesmethodid integer default nextval('salesmethods_salesmethodid_seq'::regclass) not null,
  methodname character varying(50) not null
);
create table if not exists public.vouchers (
  voucher_id text not null,
  customerid integer,
  issue_date date default CURRENT_DATE,
  expiry_date date not null,
  value numeric(10,2) not null,
  redeemed boolean default false,
  redeemed_at timestamp without time zone,
  redeemed_billid integer,
  note text,
  source text default 'manual'::text
);

alter table public.customers add constraint customers_customer_ulid_key UNIQUE (customer_ulid);
alter table public.profiles add constraint profiles_email_key UNIQUE (email);
alter table public.customers add constraint customers_auth_user_id_key UNIQUE (auth_user_id);
alter table public.bills add constraint bills_bill_number_key UNIQUE (bill_number);
alter table public.discounts add constraint discounts_code_key UNIQUE (code);
alter table public.productsizecolors add constraint unique_productid_size_color UNIQUE (productid, size, color);
alter table public.productsizecolors add constraint unique_variantid UNIQUE (variantid);
alter table public.cart_items add constraint cart_items_user_id_variant_id_key UNIQUE (user_id, variant_id);
alter table public.bill_sequences add constraint bill_sequences_pkey PRIMARY KEY (financial_year, document_type);
alter table public.categories add constraint categories_pkey PRIMARY KEY (categoryid);
alter table public.exchanges add constraint returns_pkey PRIMARY KEY (exchangeid);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.products add constraint products_pkey PRIMARY KEY (productid);
alter table public.productsizecolors add constraint productsizecolors_pkey PRIMARY KEY (variantid);
alter table public.discounts add constraint discounts_pkey PRIMARY KEY (id);
alter table public.discount_usage add constraint discount_usage_pkey PRIMARY KEY (id);
alter table public.bill_items add constraint bill_items_pkey PRIMARY KEY (bill_item_id);
alter table public.saleslocations add constraint saleslocations_pkey PRIMARY KEY (saleslocationid);
alter table public.vouchers add constraint vouchers_pkey PRIMARY KEY (voucher_id);
alter table public.salesmethods add constraint salesmethods_pkey PRIMARY KEY (salesmethodid);
alter table public.customers add constraint customers_pkey PRIMARY KEY (customerid);
alter table public.bills add constraint orders_pkey PRIMARY KEY (billid);
alter table public.cart_items add constraint cart_items_pkey PRIMARY KEY (id);
alter table public.discount_usage add constraint discount_usage_customerid_fkey FOREIGN KEY (customerid) REFERENCES customers(customerid) ON DELETE CASCADE;
alter table public.discount_usage add constraint discount_usage_code_fkey FOREIGN KEY (code) REFERENCES discounts(code) ON DELETE CASCADE;
alter table public.cart_items add constraint cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(productid);
alter table public.bill_items add constraint bill_items_billid_fkey FOREIGN KEY (billid) REFERENCES bills(billid) ON DELETE CASCADE;
alter table public.bill_items add constraint bill_items_variantid_fkey FOREIGN KEY (variantid) REFERENCES productsizecolors(variantid);
alter table public.exchanges add constraint returns_billitemid_fkey FOREIGN KEY (original_bill_item_id) REFERENCES bill_items(bill_item_id) ON DELETE SET NULL;
alter table public.vouchers add constraint vouchers_customerid_fkey FOREIGN KEY (customerid) REFERENCES customers(customerid);
alter table public.vouchers add constraint vouchers_redeemed_billid_fkey FOREIGN KEY (redeemed_billid) REFERENCES bills(billid);
alter table public.exchanges add constraint exchanges_customerid_fkey FOREIGN KEY (customerid) REFERENCES customers(customerid);
alter table public.exchanges add constraint exchanges_voucher_id_fkey FOREIGN KEY (voucher_id) REFERENCES vouchers(voucher_id);
alter table public.discount_usage add constraint discount_usage_billid_fkey FOREIGN KEY (billid) REFERENCES bills(billid) ON DELETE SET NULL;
alter table public.cart_items add constraint cart_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.productsizecolors add constraint productsizecolors_productid_fkey FOREIGN KEY (productid) REFERENCES products(productid) ON UPDATE CASCADE ON DELETE RESTRICT;
alter table public.bills add constraint orders_salesmethodid_fkey FOREIGN KEY (salesmethodid) REFERENCES salesmethods(salesmethodid);
alter table public.bills add constraint orders_saleslocationid_fkey FOREIGN KEY (saleslocationid) REFERENCES saleslocations(saleslocationid);
alter table public.customers add constraint customers_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.products add constraint products_categoryid_fkey FOREIGN KEY (categoryid) REFERENCES categories(categoryid);
alter table public.customers add constraint fk_referred_by FOREIGN KEY (referred_by) REFERENCES customers(customerid) ON DELETE SET NULL;
alter table public.cart_items add constraint cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES productsizecolors(variantid);
alter table public.bills add constraint orders_customerid_fkey FOREIGN KEY (customerid) REFERENCES customers(customerid);
alter table public.exchanges add constraint exchanges_new_billid_fkey FOREIGN KEY (new_billid) REFERENCES bills(billid) ON DELETE SET NULL;
alter table public.customers add constraint customers_community_status_check CHECK ((community_status = ANY (ARRAY['not_added'::text, 'invite_pending'::text, 'member'::text, 'left'::text, 'opted_out'::text])));
alter table public.customers add constraint chk_ulid_length CHECK ((char_length((customer_ulid)::text) = 26));
alter table public.customers add constraint chk_phone_format CHECK (((phone)::text ~ '^\+\d{10,15}$'::text));
alter table public.vouchers add constraint vouchers_source_check CHECK ((source = ANY (ARRAY['exchange'::text, 'manual'::text, 'promo'::text])));
alter table public.customers add constraint customers_store_credit_check CHECK ((store_credit >= (0)::double precision));
alter table public.discounts add constraint discounts_type_check CHECK ((type = ANY (ARRAY['flat'::text, 'percentage'::text, 'buy_x_get_y'::text, 'fixed_price'::text, 'conditional'::text, 'bundled_pricing'::text, 'gst_off'::text])));
alter table public.cart_items add constraint cart_items_quantity_check CHECK ((quantity > 0));
alter table public.bills add constraint bills_document_type_check CHECK ((document_type = ANY (ARRAY['invoice'::text, 'bos'::text])));


CREATE OR REPLACE FUNCTION public.sync_bill_salesperson_ids()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_billid BIGINT;
BEGIN
  v_billid := COALESCE(NEW.billid, OLD.billid);

  UPDATE bills
  SET salesperson_ids = (
    SELECT ARRAY(
      SELECT DISTINCT salesperson_id
      FROM bill_items
      WHERE billid = v_billid
        AND salesperson_id IS NOT NULL
      ORDER BY salesperson_id
    )
  )
  WHERE billid = v_billid;

  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_product_name()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  cat_name text;
begin
  select name
  into cat_name
  from categories
  where categoryid = new.categoryid;

  new.name := concat_ws('-', new.fabric, cat_name);

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_mockup_row()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  insert into public.mockups(productid)
  values (new.productid)
  on conflict (productid) do nothing;
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_bill_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_date DATE;
  v_fy   TEXT;
  v_seq  INTEGER;
  v_type TEXT;
BEGIN
  IF NEW.bill_number IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_type := COALESCE(NEW.document_type, 'bos');
  v_date := COALESCE(NEW.orderdate::DATE, CURRENT_DATE);

  -- Indian FY: Apr–Mar → label by start year (Apr 2026–Mar 2027 = "26")
  IF EXTRACT(MONTH FROM v_date) >= 4 THEN
    v_fy := TO_CHAR(v_date, 'YY');
  ELSE
    v_fy := TO_CHAR(v_date - INTERVAL '1 year', 'YY');
  END IF;

  INSERT INTO bill_sequences (financial_year, document_type, last_value)
  VALUES (v_fy, v_type, 1)
  ON CONFLICT (financial_year, document_type) DO UPDATE
    SET last_value = bill_sequences.last_value + 1
  RETURNING last_value INTO v_seq;

  IF v_type = 'invoice' THEN
    NEW.bill_number := 'FY' || v_fy || '-SG' || LPAD(v_seq::TEXT, 4, '0');
  ELSE
    NEW.bill_number := 'FY' || v_fy || '-' || LPAD(v_seq::TEXT, 6, '0');
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_max_product_suffix(p_prefix text)
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    max(substring(productid from '\d+$')::int),
    0
  )
  from products
  where productid like p_prefix || '%';
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_my_customer()
 RETURNS TABLE(customerid integer, customer_ulid character varying, first_name character varying, last_name character varying, phone character varying, email character varying, address text, gender character varying, needs_review boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_match_count int;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- 1. Already linked.
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if found then
    return query select * from public._customer_projection(v_row, false);
    return;
  end if;

  -- 2. Exactly one row matching the verified email -> link it.
  select count(*) into v_match_count from public.customers where lower(email) = lower(v_email);
  if v_match_count = 1 then
    update public.customers set auth_user_id = v_uid
      where lower(email) = lower(v_email) returning * into v_row;
    return query select * from public._customer_projection(v_row, false);
    return;
  elsif v_match_count > 1 then
    v_needs_review := true;  -- ambiguous; fall through to create a clean row
  end if;

  -- 3/4. Create a fresh linked row (placeholder name from email local-part).
  insert into public.customers (first_name, customer_ulid, email, auth_user_id, is_guest)
  values (
    split_part(coalesce(v_email, 'customer'), '@', 1),
    left(replace(gen_random_uuid()::text, '-', ''), 26),
    v_email, v_uid, false
  )
  returning * into v_row;

  if v_needs_review then
    update public.customers
      set customer_notes = concat_ws(E'\n', customer_notes,
        '[' || current_date || '] online signup: multiple in-store records share this email; needs manual merge')
      where customerid = v_row.customerid returning * into v_row;
  end if;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.update_my_customer(p_first_name text, p_last_name text, p_phone text, p_address text, p_gender text)
 RETURNS TABLE(customerid integer, customer_ulid character varying, first_name character varying, last_name character varying, phone character varying, email character varying, address text, gender character varying, needs_review boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text := auth.email();
  v_row public.customers;
  v_target public.customers;
  v_reclaim_count int;
  v_row_is_placeholder boolean;
  v_needs_review boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- Ensure the caller has a row (reuse resolve logic).
  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if not found then
    perform public.resolve_my_customer();
    select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  end if;

  -- The caller's row is safe to detach for a phone reclaim only if it is a
  -- dependency-free placeholder: no purchase/credit history. A real in-store
  -- record (with bills/exchanges/vouchers/discount_usage) can also have
  -- store_credit=0 and no phone, so those conditions alone are NOT sufficient
  -- and must never trigger a destructive move.
  v_row_is_placeholder :=
    coalesce(v_row.store_credit, 0) = 0
    and (v_row.phone is null or v_row.phone = '')
    and not exists (select 1 from public.bills b where b.customerid = v_row.customerid)
    and not exists (select 1 from public.exchanges e where e.customerid = v_row.customerid)
    and not exists (select 1 from public.vouchers vc where vc.customerid = v_row.customerid)
    and not exists (select 1 from public.discount_usage du where du.customerid = v_row.customerid);

  -- Guarded phone reclaim (only from a placeholder, only to a safe target).
  if p_phone is not null and p_phone <> '' and v_row_is_placeholder then
    select count(*) into v_reclaim_count from public.customers t
      where t.phone = p_phone and t.auth_user_id is null
        and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
        and t.customerid <> v_row.customerid;
    if v_reclaim_count = 1 then
      select * into v_target from public.customers t
        where t.phone = p_phone and t.auth_user_id is null
          and (t.email is null or t.email = '') and coalesce(t.store_credit,0) = 0
          and t.customerid <> v_row.customerid limit 1;
      -- auth_user_id is UNIQUE, so free the placeholder's slot before the
      -- in-store record takes the caller's identity. UNLINK (not delete): the
      -- placeholder has no FK dependents but unlinking is unconditionally safe
      -- and leaves the empty row for an admin cleanup sweep.
      update public.customers set auth_user_id = null where customerid = v_row.customerid;
      update public.customers set auth_user_id = v_uid, email = v_email
        where customerid = v_target.customerid returning * into v_row;
    elsif exists (select 1 from public.customers t where t.phone = p_phone
                  and (coalesce(t.store_credit,0) > 0 or t.email is not null)
                  and t.customerid <> v_row.customerid) then
      -- A matching record exists but is not safe to auto-claim.
      v_needs_review := true;
    end if;
  end if;

  update public.customers set
    first_name = coalesce(nullif(p_first_name,''), first_name),
    last_name  = coalesce(p_last_name, last_name),
    phone      = coalesce(nullif(p_phone,''), phone),
    address    = coalesce(p_address, address),
    gender     = coalesce(p_gender, gender),
    customer_notes = case when v_needs_review then
        concat_ws(E'\n', customer_notes,
          '[' || current_date || '] online: typed phone matches a protected in-store record; needs manual merge')
      else customer_notes end
  where customerid = v_row.customerid returning * into v_row;

  return query select * from public._customer_projection(v_row, v_needs_review);
end;
$function$
;

-- triggers last (their functions are defined above)
-- harness: trg_create_mockup_row omitted (depends on tables outside the harness: mockups, fabrics)
CREATE TRIGGER trg_set_bill_number BEFORE INSERT ON public.bills FOR EACH ROW EXECUTE FUNCTION set_bill_number();
CREATE TRIGGER bill_items_sync_salespersons AFTER INSERT OR DELETE OR UPDATE OF salesperson_id ON public.bill_items FOR EACH ROW EXECUTE FUNCTION sync_bill_salesperson_ids();
-- harness: trg_sync_product_name omitted (depends on tables outside the harness: mockups, fabrics)
