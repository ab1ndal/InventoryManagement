import React, { useEffect, useState } from "react";
import { supabase } from "lib/supabaseClient";
import ProductCard from "../ProductCard";

const RAIL_SIZE = 8;

// Other pieces from the same category. The anon RLS policy already limits
// `products` to rows with photos, so every card here has an image.
export default function MoreLikeThis({ categoryid, excludeId }) {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    if (!categoryid) return;
    let active = true;
    supabase
      .from("products")
      .select("productid, name, retailprice, producturl, fabric, categoryid, categories(name)")
      .eq("categoryid", categoryid)
      .neq("productid", excludeId)
      .order("productid", { ascending: false })
      .limit(RAIL_SIZE)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("More like this: failed to load products", { categoryid, error });
          return;
        }
        setProducts(data ?? []);
      });
    return () => {
      active = false;
    };
  }, [categoryid, excludeId]);

  if (products.length === 0) return null;

  return (
    <section aria-labelledby="more-like-this" className="mt-20">
      <div className="flex items-center gap-3 mb-6">
        <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
        <h2
          id="more-like-this"
          className="font-display text-2xl lg:text-3xl font-semibold text-storefront-charcoal"
        >
          More like this
        </h2>
      </div>
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
        {products.map((p) => (
          <div
            key={p.productid}
            className="w-[46%] sm:w-[31%] lg:w-[calc(25%-12px)] flex-shrink-0 snap-start"
          >
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
