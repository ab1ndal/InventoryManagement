-- A phone number typed on the account page proves nothing, so it must never link a shopper to an
-- existing customer record. Staff merge records by hand instead, and identity comes only from a
-- verified email (resolve_my_customer). Phone numbers are unique, so a typed number that another record
-- already holds is not saved: the shopper keeps theirs, and the row is noted for a manual merge.

create or replace function public.update_my_customer(
  p_first_name text, p_last_name text, p_phone text, p_address text, p_gender text)
returns table(customerid integer, customer_ulid character varying, first_name character varying,
  last_name character varying, phone character varying, email character varying, address text,
  gender character varying, needs_review boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_row public.customers;
  v_phone_taken boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  if not found then
    perform public.resolve_my_customer();
    select * into v_row from public.customers where auth_user_id = v_uid limit 1;
  end if;

  if nullif(p_phone, '') is not null then
    v_phone_taken := exists (
      select 1 from public.customers t
       where t.phone = p_phone and t.customerid <> v_row.customerid);
  end if;

  update public.customers set
    first_name = coalesce(nullif(p_first_name,''), first_name),
    last_name  = coalesce(p_last_name, last_name),
    phone      = case when v_phone_taken then phone else coalesce(nullif(p_phone,''), phone) end,
    address    = coalesce(p_address, address),
    gender     = coalesce(p_gender, gender),
    customer_notes = case when v_phone_taken then
        concat_ws(E'\n', customer_notes,
          '[' || current_date || '] online: typed phone matches another record; needs manual merge')
      else customer_notes end
  where customerid = v_row.customerid returning * into v_row;

  return query select * from public._customer_projection(v_row, v_phone_taken);
end;
$function$;
