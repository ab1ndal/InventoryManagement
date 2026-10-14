import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import ProductRail, { RAIL_PRODUCT_COLUMNS, RAIL_SIZE } from "./ProductRail";
import { getCollection } from "../../lib/collections";

/** Newest products in a category collection; "View all" opens that collection. */
export default function CategoryRail({ slug, title, tone }) {
  const { categoryIds } = getCollection(slug);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select(RAIL_PRODUCT_COLUMNS)
      .in("categoryid", categoryIds)
      .order("productid", { ascending: false })
      .limit(RAIL_SIZE)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, [categoryIds]);

  return (
    <ProductRail title={title} products={products} loading={loading} viewAllHref={`/collections/${slug}`} tone={tone} />
  );
}
