create table public.bill_sequences (
  financial_year text not null,
  last_value integer not null,
  constraint bill_sequences_pkey primary key (financial_year)
) TABLESPACE pg_default;