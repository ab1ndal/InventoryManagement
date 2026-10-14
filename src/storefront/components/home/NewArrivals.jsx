import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import ProductRail, { RAIL_PRODUCT_COLUMNS, RAIL_SIZE } from "./ProductRail";

export default function NewArrivals() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select(RAIL_PRODUCT_COLUMNS)
      .order("productid", { ascending: false })
      .limit(RAIL_SIZE)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <ProductRail
      eyebrow="Just in"
      title="New Arrivals"
      products={products}
      loading={loading}
      viewAllHref="/shop"
      tone="cream"
    />
  );
}
