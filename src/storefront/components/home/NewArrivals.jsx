import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { ChevronLeft, ChevronRight } from "lucide-react";
import ProductCard from "../ProductCard";

function ProductSkeleton() {
  return (
    <div className="flex-shrink-0 w-52 sm:w-60">
      <div className="aspect-[3/4] bg-storefront-border/50 animate-pulse rounded-sm" />
      <div className="mt-2 space-y-1.5">
        <div className="h-3.5 bg-storefront-border/50 animate-pulse rounded w-3/4" />
        <div className="h-3.5 bg-storefront-border/50 animate-pulse rounded w-1/3" />
      </div>
    </div>
  );
}

export default function NewArrivals() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    supabase
      .from("products")
      .select("productid, name, retailprice, producturl, fabric, categoryid, categories(name)")
      .order("productid", { ascending: false })
      .limit(10)
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, []);

  function scroll(dir) {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 280, behavior: "smooth" });
  }

  return (
    <section className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header row */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <div className="flex items-center gap-3 mb-3">
              <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
              <span className="font-sans text-xs tracking-[0.25em] uppercase text-storefront-gold">
                Just In
              </span>
            </div>
            <h2 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal">
              New Arrivals
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll(-1)}
              aria-label="Scroll left"
              className="w-9 h-9 rounded-full border border-storefront-border flex items-center justify-center text-storefront-charcoal hover:border-storefront-gold hover:text-storefront-gold transition-colors cursor-pointer"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => scroll(1)}
              aria-label="Scroll right"
              className="w-9 h-9 rounded-full border border-storefront-border flex items-center justify-center text-storefront-charcoal hover:border-storefront-gold hover:text-storefront-gold transition-colors cursor-pointer"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {/* Horizontal scroll */}
        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide"
          style={{ scrollSnapType: "x mandatory" }}
        >
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex-shrink-0 w-52 sm:w-60" style={{ scrollSnapAlign: "start" }}>
                  <ProductSkeleton />
                </div>
              ))
            : products.map((p) => (
                <div
                  key={p.productid}
                  className="flex-shrink-0 w-52 sm:w-60"
                  style={{ scrollSnapAlign: "start" }}
                >
                  <ProductCard product={p} />
                </div>
              ))}
        </div>

        {/* View all */}
        <div className="text-center mt-10">
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 font-sans text-sm font-medium tracking-widest uppercase text-storefront-charcoal border-b border-storefront-charcoal hover:text-storefront-gold hover:border-storefront-gold transition-colors pb-0.5"
          >
            View All New Arrivals
          </Link>
        </div>
      </div>
    </section>
  );
}
