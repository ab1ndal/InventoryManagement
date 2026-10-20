import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "lib/supabaseClient";
import ProductCard from "../ProductCard";
import { categoryGroup, rankSimilar } from "../../lib/similarProducts";

// Newest pieces in the category group, ranked client-side. Groups top out
// around 200 visible products, so one capped query covers the whole pool.
const CANDIDATE_LIMIT = 200;

// Pieces like this one: same category group (e.g. all suit types), ranked by
// price, colour and fabric, sold-out items dropped. The anon RLS policy
// already limits `products` to rows with photos, so every card has an image.
export default function MoreLikeThis({ product, colours }) {
  const [products, setProducts] = useState([]);
  const { productid, categoryid } = product;
  const group = categoryGroup(categoryid);

  useEffect(() => {
    if (!categoryid) return;
    let active = true;
    supabase
      .from("products")
      .select(
        "productid, name, retailprice, producturl, fabric, categoryid, categories(name), productsizecolors(stock, color)"
      )
      .in("categoryid", group?.categoryIds ?? [categoryid])
      .neq("productid", productid)
      .order("productid", { ascending: false })
      .limit(CANDIDATE_LIMIT)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("More like this: failed to load products", { categoryid, error });
          return;
        }
        setProducts(rankSimilar(product, colours, data ?? []));
      });
    return () => {
      active = false;
    };
  }, [product, colours, group, productid, categoryid]);

  if (products.length === 0) return null;

  return (
    <section aria-labelledby="more-like-this" className="mt-20">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <h2
            id="more-like-this"
            className="font-display text-2xl lg:text-3xl font-semibold text-storefront-charcoal"
          >
            More like this
          </h2>
        </div>
        {group && (
          <Link
            to={`/collections/${group.slug}`}
            className="inline-flex items-center gap-1.5 text-[11px] font-sans tracking-[0.15em] uppercase text-storefront-charcoal hover:text-storefront-gold transition-colors whitespace-nowrap"
          >
            View all {group.title}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      {/* Swipe row on phones and tablets; full grid on desktop so no card hides off-screen. */}
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:pb-0">
        {products.map((p) => (
          <div
            key={p.productid}
            className="w-[46%] sm:w-[31%] lg:w-auto flex-shrink-0 snap-start"
          >
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}
