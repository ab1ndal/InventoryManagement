import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import ProductRail, { RAIL_PRODUCT_COLUMNS, RAIL_SIZE } from "./ProductRail";
import { getCollection } from "../../lib/collections";
import { railHref } from "../../lib/homeRails";

/** Newest products in a category collection (optionally up to maxPrice); "View all" opens that collection. */
export default function CategoryRail({ slug, title, tone, maxPrice }) {
  const { categoryIds } = getCollection(slug);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let query = supabase.from("products").select(RAIL_PRODUCT_COLUMNS).in("categoryid", categoryIds);
    if (maxPrice) query = query.lte("retailprice", maxPrice);
    query
      .order("productid", { ascending: false })
      .limit(RAIL_SIZE)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, [categoryIds, maxPrice]);

  return (
    <ProductRail title={title} products={products} loading={loading} viewAllHref={railHref({ slug, maxPrice })} tone={tone} />
  );
}
