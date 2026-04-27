import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import ProductCard from "../ProductCard";

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[3/4] bg-storefront-border/40 animate-pulse rounded-sm" />
          <div className="mt-2 space-y-1.5">
            <div className="h-3.5 bg-storefront-border/40 animate-pulse rounded w-3/4" />
            <div className="h-3.5 bg-storefront-border/40 animate-pulse rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BestsellerGrid() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select("productid, name, retailprice, producturl, fabric, categoryid, categories(name)")
      .order("retailprice", { ascending: false })
      .limit(6)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-montserrat text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Bestsellers
          </span>
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
        </div>
        <h2 className="font-cormorant font-semibold text-4xl sm:text-5xl text-storefront-charcoal">
          Most Loved Pieces
        </h2>
        <p className="font-montserrat text-sm text-storefront-muted mt-3 max-w-md mx-auto">
          Our customers' all-time favourites — timeless, versatile, and crafted to perfection.
        </p>
      </div>

      {loading ? (
        <GridSkeleton />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 lg:gap-6">
          {products.map((p, i) => (
            <ProductCard key={p.productid} product={p} priority={i < 3} />
          ))}
        </div>
      )}

      <div className="text-center mt-12">
        <Link
          to="/shop"
          className="inline-flex items-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-montserrat text-sm font-medium tracking-widest uppercase px-10 py-3.5 transition-colors duration-200"
        >
          View All Products
        </Link>
      </div>
    </section>
  );
}
