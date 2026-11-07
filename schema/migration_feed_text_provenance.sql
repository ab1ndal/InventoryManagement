-- Merchant feed: say which titles and descriptions were drafted by AI (2026-11-06).
-- Google requires AI-generated text in structured_title / structured_description with
-- digital_source_type trained_algorithmic_media (support.google.com/merchants/answer/14743464).
-- The feed reads products as anon, which could not see the two columns that record this.
--
-- title_detail is already public inside display_title. description_source only says whether a
-- description was AI-drafted, which the feed states publicly anyway.
--
-- Apply BEFORE deploying the feed change: selecting an ungranted column fails the whole query,
-- and the feed would answer 503.

grant select (title_detail, description_source) on public.products to anon;
