# Unrecorded migrations audit (live DB, read-only, 2026-10-20)

`_migrations` holds 16 rows (6 of the 32 on-disk files + 10 legacy names). The 26 below are unrecorded.
Runner order is **alphabetical**, not chronological (e.g. colors_families < colors_reference, fabric_drop_family < fabric_families_add, storefront_products_with_images < storefront_public_read).

| file | verdict | evidence | rerun-safe? |
|---|---|---|---|
| migration_attributes_manager_rls.sql | APPLIED | 4 "authenticated update {colors,color_families,fabrics,sizes}" UPDATE policies present | yes (drop-if-exists/create), BUT has begin/commit, so runner fails 0A000 |
| migration_bill_of_supply.sql | APPLIED | bills.document_type + check, bill_sequences PK (financial_year,document_type), set_bill_number body = file, generate_bill_number gone | yes (IF NOT EXISTS / OR REPLACE / IF EXISTS); has BEGIN/COMMIT |
| migration_color_families_table.sql | APPLIED | color_families table, 15 families in file order, 3 policies | no: `create table` errors (aborts); seed has no ON CONFLICT |
| migration_color_mechanical_images.sql | APPLIED | 0 non-canonical mockup_variations.color / productimages.productcolor; _backup_mockupvar_color/_productimages_20260708 exist | no: backup `create table` errors; data UPDATE |
| migration_color_mechanical.sql | APPLIED | 3 _backup_*_color_20260708 tables; only 1 non-canonical psc color ('multi figure', admin-added 2026-07-10) | no: backup create errors; variant merge/delete + data rewrite |
| migration_color_semantic.sql | APPLIED | 5 _backup_*_sem_20260708 tables; 0 rows with merged-away spellings; Cream/Firozi/Grey/Maroon etc. present | no: backup create errors; merge/delete + data rewrite |
| migration_colors_families.sql | APPLIED (later admin edits on top) | 403 colors = 399 seed + 4 added via admin 2026-07-10/07-21; 0 empty families; owner codes Gold/Olive/... created 2026-07-09 | **no, harmful**: resets families to CSV (wipes Attributes-manager edits) and DELETEs codes not in seed (4 admin-added) |
| migration_colors_fk.sql | APPLIED | psc/mockup_variations/productimages color FKs exist and validated; "authenticated insert colors" policy | no: ADD CONSTRAINT / CREATE POLICY error on dup |
| migration_colors_reference.sql | APPLIED (seed superseded by colors_families) | colors table + anon/auth read policies; productimages.caption renamed to productcolor | no: create table / rename error |
| migration_drop_bill_items_stitching_charge.sql | APPLIED | bill_items has no stitching_charge column | yes (DROP COLUMN IF EXISTS) |
| migration_fabric_drop_family.sql | APPLIED | fabrics has no `family` column | no: DROP COLUMN without IF EXISTS errors |
| migration_fabric_families_add.sql | APPLIED (family col later dropped, consistent) | fabrics.families text[] NOT NULL default '{}'; some rows have 2 families; _backup_fabrics_family_20260709 exists | **no, harmful in principle**: `update fabrics set families = array[family]` would wipe multi-family edits (errors today since family col gone) |
| migration_fabric_fk.sql | APPLIED | products_fabric_fkey validated; "authenticated insert fabrics" policy | no: dup constraint/policy errors |
| migration_fabric_normalization.sql | APPLIED (family col superseded) | fabrics 92 codes (= file); 0 products with stray spellings; _backup_products_fabric_20260708; anon/auth read policies | no: backup/create table error; data UPDATEs |
| migration_payment_amount_running_total.sql | APPLIED | 0 bills where payment_amount != sum(bill_payments) (6 multi-payment bills all in step) | yes (UPDATE guarded by mismatch; no-op today) |
| migration_shop_available_options_rpc.sql | APPLIED | get_shop_available_options body = file; anon+authenticated EXECUTE | yes (OR REPLACE + GRANT) |
| migration_shop_filter_options_rpc.sql | APPLIED | get_shop_filter_options body = file; anon+authenticated EXECUTE | yes (OR REPLACE + GRANT) |
| migration_size_normalization.sql | APPLIED (+ post-deploy VALIDATE done) | sizes = 59 rows matching seed exactly by type (12 letter, 9 waist, 32 kids, 3 kids_letter, 3 special); sizes_code_trimmed check; productsizecolors_size_fkey validated; 0 old size spellings; 4 _backup_*_20260708 tables | **no, harmful**: backup create errors; would `delete from sizes` + reseed (drops admin-added sizes); variant merges |
| migration_sizes_admin_insert.sql | APPLIED | sizes.created_at/created_by columns; "authenticated insert sizes" policy | no: ADD COLUMN without IF NOT EXISTS errors |
| migration_sizes_authenticated_read.sql | APPLIED | "authenticated read sizes" policy present | no: CREATE POLICY without drop errors |
| migration_storefront_authenticated_read.sql | APPLIED | 4 "storefront authenticated read" policies; products one has productimages EXISTS filter | yes (drop/create) |
| migration_storefront_cost_price_lockdown.sql | APPLIED | anon has no table SELECT on products, column SELECT on all except purchaseprice; no SELECT on mockups_view | yes (revoke/grant) |
| migration_storefront_customer_auth.sql | APPLIED | customers.auth_user_id unique FK to auth.users ON DELETE SET NULL; 3 function bodies = file; anon no EXECUTE, authenticated EXECUTE | yes (IF NOT EXISTS / OR REPLACE / grants) |
| migration_storefront_productimages_read.sql | APPLIED | "storefront anon read productimages" using(true) | yes (drop/create) |
| migration_storefront_products_with_images.sql | APPLIED | anon products policy = EXISTS productimages; productimages_productid_idx exists | yes (IF NOT EXISTS + drop/create) |
| migration_storefront_public_read.sql | SUPERSEDED-consistent | anon read policies on psc/categories/sizes, storage "storefront anon list mockups", anon EXECUTE get_distinct_sizes present; products policy since replaced by products_with_images | **no, harmful**: recreates anon products policy as using(true), undoing the image-only filter (sorts after products_with_images, so it wins) |

## BEGIN/COMMIT (14 of 32)
migration_attributes_manager_rls, migration_bill_of_supply, migration_color_families_table, migration_color_mechanical_images, migration_color_mechanical, migration_color_semantic, migration_colors_families, migration_colors_fk, migration_colors_reference, migration_fabric_drop_family, migration_fabric_families_add, migration_fabric_fk, migration_fabric_normalization, migration_size_normalization (.sql). The other 18 have none.

## Backfill: all 26
None NOT APPLIED or PARTIAL.
