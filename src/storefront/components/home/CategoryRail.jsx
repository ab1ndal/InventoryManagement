import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import ProductRail, { RAIL_PRODUCT_COLUMNS, RAIL_SIZE } from "./ProductRail";

/** Newest products in one category. `/shop` has no URL category filter yet, so "View all" opens the full shop. */
export default function CategoryRail({ categoryid, title, tone }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select(RAIL_PRODUCT_COLUMNS)
      .eq("categoryid", categoryid)
      .order("productid", { ascending: false })
      .limit(RAIL_SIZE)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, [categoryid]);

  return (
    <ProductRail title={title} products={products} loading={loading} viewAllHref="/shop" tone={tone} />
  );
}
