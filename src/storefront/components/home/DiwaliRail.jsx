import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import { getCollection } from "../../lib/collections";
import ProductRail, { RAIL_PRODUCT_COLUMNS, RAIL_SIZE } from "./ProductRail";

const DIWALI = getCollection("diwali");
// The curated list is ordered best first; the rail shows the top of it.
const RAIL_IDS = DIWALI.productIds.slice(0, RAIL_SIZE);

export default function DiwaliRail() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select(RAIL_PRODUCT_COLUMNS)
      .in("productid", RAIL_IDS)
      .then(({ data }) => {
        // `in` returns rows in database order; restore the curated order.
        const rank = new Map(RAIL_IDS.map((id, i) => [id, i]));
        setProducts((data || []).slice().sort((a, b) => rank.get(a.productid) - rank.get(b.productid)));
        setLoading(false);
      });
  }, []);

  return (
    <ProductRail
      title={DIWALI.title}
      products={products}
      loading={loading}
      viewAllHref={`/collections/${DIWALI.slug}`}
    />
  );
}
