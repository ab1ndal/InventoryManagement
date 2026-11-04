-- Behaviour test for migration_customer_phone_link.sql. Run inside a transaction that is rolled back:
--   begin; <this file>; rollback;
-- Prints pass or fail flags only, never customer details.
insert into auth.users (id, email, email_confirmed_at, aud, role, created_at, updated_at)
values ('00000000-0000-4000-8000-00000000c001', 'phone-link-test@example.invalid', now(), 'authenticated', 'authenticated', now(), now());

insert into public.customers (customer_ulid, first_name, last_name, phone, address)
values ('01TESTPHONELINK00000000001', 'Stored', 'Record', '+919000000001', 'Stored address');

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000c001","email":"phone-link-test@example.invalid","role":"authenticated"}', true);
set local role authenticated;

create temp table r_taken on commit drop as
  select * from public.update_my_customer(null, null, '+919000000001', null, null);
create temp table r_free on commit drop as
  select * from public.update_my_customer('Shopper', null, '+919000000002', null, null);

reset role;

select
  (select needs_review from r_taken) as flagged_for_review,
  (select coalesce(phone,'') <> '+919000000001' from r_taken) as own_row_keeps_no_taken_phone,
  (select coalesce(address,'') <> 'Stored address' from r_taken) as stored_address_not_returned,
  (select auth_user_id is null and coalesce(email,'') = '' from public.customers where phone = '+919000000001') as stored_record_untouched,
  (select phone = '+919000000002' and first_name = 'Shopper' and not needs_review from r_free) as free_phone_saved,
  (select count(*) = 1 from public.customers where auth_user_id = '00000000-0000-4000-8000-00000000c001') as one_row_for_this_user;
