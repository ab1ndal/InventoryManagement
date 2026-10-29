-- =====================================================================
-- salesmethods: realign the id sequence with its rows.
--
-- The live sequence lagged its rows (last_value 6, max id 7 on 2026-10-29;
-- the 'Website' row was inserted with an explicit id for that reason, see
-- migration_online_orders.sql). The next default-id insert of an in-store
-- payment method would collide with an existing key.
--
-- Idempotent: setval to the current max id (or 1, unused, on an empty table).
-- =====================================================================

select setval(
  pg_get_serial_sequence('public.salesmethods', 'salesmethodid'),
  coalesce((select max(salesmethodid) from public.salesmethods), 1),
  (select count(*) > 0 from public.salesmethods)
);
