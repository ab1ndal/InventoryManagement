-- Storage RLS policies for the "supplier-bills" bucket, mirroring "invoices".
-- The "supplier-bills" bucket was created via the Storage API.
-- Run this in the Supabase SQL editor (storage.objects requires owner privileges
-- not available to the exec_sql RPC).

CREATE POLICY admin_insert_supplier_bills ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'supplier-bills' AND is_admin());

CREATE POLICY admin_select_supplier_bills ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'supplier-bills' AND is_admin());

CREATE POLICY admin_update_supplier_bills ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'supplier-bills' AND is_admin());
