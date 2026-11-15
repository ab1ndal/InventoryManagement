-- PROPOSAL, not applied (written 2026-11-14). Nothing calls this yet; the owner applies it.
--
-- A bill spec's stock_adds (admin CLI, docs/admin-cli.md) add stock, or a new variant, for a piece
-- that is on the shelf but not in the inventory, and then save the bill. Until this is applied the
-- CLI does that as separate writes: stock_adjust or a productsizecolors insert (the `stock add`
-- writes), then bill_save, and when bill_save fails it undoes the adds from the client
-- (src/admin/lib/variants.js undoStockAdds). That leaves two gaps:
--   - the CLI dying, or losing its connection, between the adds and the undo leaves the stock added;
--   - a bill_save that committed but whose reply was lost looks failed, so the undo takes back
--     stock the bill has already taken.
-- This function closes both: the adds and the bill are one transaction, and a retried key does not
-- add the stock a second time.
--
--   bill_save_with_stock_adds(p_key uuid, p_op text, p_payload jsonb, p_stock_adds jsonb) returns jsonb
--     p_stock_adds: [{ "variantid": uuid, "productid": text, "size": text, "color": text,
--                      "qty": numeric > 0, "create": boolean }]
--     "create": true inserts the variant with stock qty (the client sends a fresh uuid, as
--     addVariantStock does); otherwise stock += qty on the existing variant. Then
--     bill_save(p_key, p_op, p_payload), whose result it returns. Any error rolls back all of it.
--     A key already in bill_save_log (a retry) skips the adds and bill_save replays its result.
--
-- The CLI would call it for finalized and part-paid bills. A new draft has no bill_save op (it is
-- inserted as the screen's Save Draft does), so drafts keep the client-side undo.
-- Activity-log entries stay with the client, as for every other bill write.

-- Fail fast instead of queueing the live in-store app behind this migration.
set local lock_timeout = '3s';

create or replace function public.bill_save_with_stock_adds(
  p_key uuid, p_op text, p_payload jsonb, p_stock_adds jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_add jsonb;
  v_qty numeric;
begin
  if not public._is_staff_or_service() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_stock_adds, '[]'::jsonb)) <> 'array' then
    raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'stock_adds must be an array';
  end if;

  -- Two calls with the same key take turns, so the second sees the first's key and adds nothing.
  perform pg_advisory_xact_lock(hashtext('bill_save_with_stock_adds:' || p_key::text));

  if not exists (select 1 from public.bill_save_log where idempotency_key = p_key) then
    for v_add in select * from jsonb_array_elements(coalesce(p_stock_adds, '[]'::jsonb)) loop
      v_qty := (v_add->>'qty')::numeric;
      if v_qty is null or v_qty <= 0 then
        raise exception 'BILL_BAD_PAYLOAD' using errcode = 'P0001', detail = 'stock_adds qty must be > 0';
      end if;
      if coalesce((v_add->>'create')::boolean, false) then
        -- The row addVariantStock inserts. The size and colour foreign keys and the
        -- (productid, size, color) unique constraint still apply.
        insert into public.productsizecolors (variantid, productid, size, color, stock)
        values ((v_add->>'variantid')::uuid, v_add->>'productid', v_add->>'size', v_add->>'color', v_qty);
      else
        perform public._stock_apply((v_add->>'variantid')::uuid, v_qty);
      end if;
    end loop;
  end if;

  return public.bill_save(p_key, p_op, p_payload);
end;
$$;

revoke all on function public.bill_save_with_stock_adds(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.bill_save_with_stock_adds(uuid, text, jsonb, jsonb) to authenticated, service_role;
