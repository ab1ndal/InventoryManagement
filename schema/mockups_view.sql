create view public.mockups_view as
select
  m.productid,
  m.redo,
  m.base_mockup,
  m.file_mockup,
  m.mockup,
  m.video,
  m.ig_post,
  m.ig_reel,
  m.whatsapp,
  m.ig_post_date,
  m.whatsapp_post_date,
  p.purchaseprice,
  p.fabric,
  c.name as category,
  string_agg(distinct sc.size::text, ', '::text) as sizes,
  string_agg(distinct sc.color::text, ', '::text) as colors,
  SUBSTRING(
    m.productid
    from
      3 for 2
  )::integer as year_code,
  SUBSTRING(
    m.productid
    from
      5
  )::integer as product_num
from
  mockups m
  join products p on p.productid::text = m.productid::text
  left join categories c on c.categoryid::text = p.categoryid::text
  left join productsizecolors sc on sc.productid::text = m.productid::text
group by
  m.productid,
  p.purchaseprice,
  p.fabric,
  c.name;