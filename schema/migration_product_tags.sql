-- Product tags: owner-approved vocabulary + per-product tags (owner approved the vocabulary 2026-10-25).
--
-- tag_vocab holds the only allowed values. Its source of truth is
-- scripts/describe/tag_vocab.json; applies_to expands that file's category families into
-- categoryids so the storefront can filter by category without knowing about families.
-- product_tags.source uses the same values as products.description_source:
--   ai           AI tag applied without review (high confidence only)
--   ai_reviewed  AI tag the owner approved
--   manual       added by hand in admin
-- Work placement is not a tag; it stays in the description text.
--
-- Reads: anon and signed-in storefront users read the whole vocabulary, and tags of the
-- products they can already see (same productimages rule as the products read policies).
-- Writes: admins via is_admin(); the describe batch writes with the service role.

create table if not exists public.tag_vocab (
  tag_group  text not null check (tag_group in ('occasion', 'work', 'print_weave', 'silhouette', 'length', 'neck', 'sleeve')),
  value      text not null,
  label      text not null,
  applies_to text[] not null,
  sort_order int  not null,
  primary key (tag_group, value)
);

create table if not exists public.product_tags (
  productid  varchar not null references public.products (productid) on delete cascade,
  tag_group  text not null,
  value      text not null,
  source     text not null check (source in ('ai', 'ai_reviewed', 'manual')),
  confidence real check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  primary key (productid, tag_group, value),
  foreign key (tag_group, value) references public.tag_vocab (tag_group, value) on update cascade
);

-- Shop filters look up products by tag.
create index if not exists product_tags_group_value_idx on public.product_tags (tag_group, value);

alter table public.tag_vocab enable row level security;
alter table public.product_tags enable row level security;

revoke all on public.tag_vocab from anon, authenticated;
revoke all on public.product_tags from anon, authenticated;
grant select on public.tag_vocab to anon, authenticated;
grant select on public.product_tags to anon, authenticated;
grant insert, update, delete on public.tag_vocab to authenticated;
grant insert, update, delete on public.product_tags to authenticated;

create policy admin_only on public.tag_vocab for all using (is_admin()) with check (is_admin());
create policy admin_only on public.product_tags for all using (is_admin()) with check (is_admin());

create policy "storefront read tag_vocab" on public.tag_vocab
  for select to anon, authenticated using (true);

create policy "storefront read product_tags" on public.product_tags
  for select to anon, authenticated
  using (exists (select 1 from public.productimages pi where pi.productid = product_tags.productid));

insert into public.tag_vocab (tag_group, value, label, applies_to, sort_order) values
  ('occasion', 'wedding', 'Wedding', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 1),
  ('occasion', 'reception', 'Reception', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 2),
  ('occasion', 'sangeet', 'Sangeet', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 3),
  ('occasion', 'mehndi-haldi', 'Mehndi & Haldi', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 4),
  ('occasion', 'festive', 'Festive', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 5),
  ('occasion', 'party', 'Party', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 6),
  ('occasion', 'casual', 'Casual', array['SA', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 7),
  ('occasion', 'office', 'Office', array['SA', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 8),
  ('work', 'embroidery', 'Embroidery', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 1),
  ('work', 'thread', 'Thread work', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 2),
  ('work', 'resham', 'Resham', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 3),
  ('work', 'zari', 'Zari', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 4),
  ('work', 'zardosi', 'Zardosi', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 5),
  ('work', 'aari', 'Aari', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 6),
  ('work', 'chikankari', 'Chikankari', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 7),
  ('work', 'sequin', 'Sequin', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 8),
  ('work', 'cutdana', 'Cutdana', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 9),
  ('work', 'nalki', 'Nalki', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 10),
  ('work', 'stone', 'Stone', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 11),
  ('work', 'moti', 'Moti & beads', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 12),
  ('work', 'mirror', 'Mirror', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 13),
  ('work', 'gota-patti', 'Gota patti', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 14),
  ('work', 'patch', 'Patch work', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 15),
  ('work', 'cut-work', 'Cut work', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 16),
  ('work', 'lace', 'Lace & trims', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 17),
  ('work', 'pintuck', 'Pintucks', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 18),
  ('print_weave', 'plain', 'Plain', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 1),
  ('print_weave', 'self-design', 'Self design', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 2),
  ('print_weave', 'floral-print', 'Floral print', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 3),
  ('print_weave', 'geometric-print', 'Geometric / abstract print', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 4),
  ('print_weave', 'paisley', 'Paisley', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 5),
  ('print_weave', 'digital-print', 'Digital print', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 6),
  ('print_weave', 'foil-print', 'Foil print', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 7),
  ('print_weave', 'block-print', 'Block print', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 8),
  ('print_weave', 'bandhej', 'Bandhej', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 9),
  ('print_weave', 'leheriya', 'Leheriya', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 10),
  ('print_weave', 'butis', 'Butis', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 11),
  ('print_weave', 'checks', 'Checks', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 12),
  ('print_weave', 'stripes', 'Stripes', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 13),
  ('print_weave', 'banarasi', 'Banarasi weave', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 14),
  ('print_weave', 'brocade', 'Brocade', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 15),
  ('print_weave', 'jacquard', 'Jacquard', array['SA', 'LE', 'ST', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 16),
  ('silhouette', 'straight', 'Straight', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 1),
  ('silhouette', 'a-line', 'A-line', array['LE', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 2),
  ('silhouette', 'anarkali', 'Anarkali', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 3),
  ('silhouette', 'flared', 'Flared', array['LE', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 4),
  ('silhouette', 'kalidar', 'Kalidar', array['LE', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 5),
  ('silhouette', 'mermaid', 'Mermaid', array['LE', 'KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 6),
  ('silhouette', 'fit-and-flare', 'Fit and flare', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 7),
  ('silhouette', 'angrakha', 'Angrakha', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 8),
  ('silhouette', 'asymmetric', 'Asymmetric', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 9),
  ('silhouette', 'kaftan', 'Kaftan', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 10),
  ('silhouette', 'slim-fit', 'Slim fit', array['KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 11),
  ('silhouette', 'regular-fit', 'Regular fit', array['KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 12),
  ('length', 'crop', 'Crop', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 1),
  ('length', 'hip', 'Hip length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 2),
  ('length', 'thigh', 'Thigh length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 3),
  ('length', 'knee', 'Knee length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 4),
  ('length', 'below-knee', 'Below knee', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 5),
  ('length', 'calf', 'Calf length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 6),
  ('length', 'ankle', 'Ankle length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 7),
  ('length', 'floor', 'Floor length', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 8),
  ('neck', 'round', 'Round neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 1),
  ('neck', 'v-neck', 'V-neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 2),
  ('neck', 'band-collar', 'Band collar', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 3),
  ('neck', 'shirt-collar', 'Shirt collar', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 4),
  ('neck', 'boat', 'Boat neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 5),
  ('neck', 'square', 'Square neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 6),
  ('neck', 'sweetheart', 'Sweetheart', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 7),
  ('neck', 'high-neck', 'High neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 8),
  ('neck', 'off-shoulder', 'Off-shoulder', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 9),
  ('neck', 'notched', 'Notched neck', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 10),
  ('neck', 'lapel', 'Lapel', array['SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 11),
  ('neck', 'polo', 'Polo collar', array['SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 12),
  ('sleeve', 'sleeveless', 'Sleeveless', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 1),
  ('sleeve', 'short', 'Short sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 2),
  ('sleeve', 'elbow', 'Elbow sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 3),
  ('sleeve', 'three-quarter', 'Three-quarter sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P'], 4),
  ('sleeve', 'full', 'Full sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP', 'KP', 'SW', 'SK', 'NHJ', 'IW', 'SJ-2P', 'SJ-3P', 'SHT', 'T-SHT', 'BLZ', 'S2P', 'S3P', 'S5P', 'PNT', 'FRMP'], 5),
  ('sleeve', 'bell', 'Bell sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 6),
  ('sleeve', 'puff', 'Puff sleeves', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 7),
  ('sleeve', 'cold-shoulder', 'Cold-shoulder', array['KUR', 'RMS', 'GWN', 'DRS', 'CRD', 'TOP', 'SHR', 'SKT-TOP'], 8)
on conflict (tag_group, value) do nothing;
