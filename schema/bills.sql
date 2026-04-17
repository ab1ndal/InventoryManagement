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
  applied_codes text[] null default '{}'::text[],
  payment_amount numeric(10, 2) null,
  net_amount numeric(10, 2) null,
  store_credit_used numeric(10, 2) not null default 0,
  bill_number text null,
  constraint orders_pkey primary key (billid),
  constraint bills_bill_number_key unique (bill_number),
  constraint orders_customerid_fkey foreign KEY (customerid) references customers (customerid),
  constraint orders_saleslocationid_fkey foreign KEY (saleslocationid) references saleslocations (saleslocationid),
  constraint orders_salesmethodid_fkey foreign KEY (salesmethodid) references salesmethods (salesmethodid)
) TABLESPACE pg_default;

create trigger trg_set_bill_number BEFORE INSERT on bills for EACH row
execute FUNCTION set_bill_number ();