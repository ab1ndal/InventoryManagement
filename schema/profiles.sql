create table public.profiles (
  id uuid not null,
  email text not null default '''abc@example.com''::text'::text,
  role text null default 'user'::text,
  created_at timestamp with time zone null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_email_key unique (email)
) TABLESPACE pg_default;