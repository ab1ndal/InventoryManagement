import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../../lib/productImage";
import { getCollection } from "../../lib/collections";

// A category earns an icon once it has this many listed products.
const MIN_PRODUCTS = 10;
// Icons render at 72px; 150 is the nearest whitelisted width for 2x screens.
const ICON_TRANSFORM = { width: 150, quality: 70 };

const DIWALI = getCollection("diwali");

/**
 * Pick the categories to show and the product whose photo represents each.
 * @param {{categoryid:string,name:string}[]} categories
 * @param {{productid:string,categoryid:string}[]} products  newest first
 * @param {number} minCount
 * @returns {{categoryid:string,name:string,newestProductId:string}[]} most stocked first
 */
export function pickBandCategories(categories, products, minCount) {
  const counts = new Map();
  const newest = new Map();
  for (const { productid, categoryid } of products) {
    counts.set(categoryid, (counts.get(categoryid) || 0) + 1);
    if (!newest.has(categoryid)) newest.set(categoryid, productid);
  }
  return categories
    .filter((c) => (counts.get(c.categoryid) || 0) >= minCount)
    .sort((a, b) => counts.get(b.categoryid) - counts.get(a.categoryid))
    .map((c) => ({
      categoryid: c.categoryid,
      name: c.name,
      newestProductId: newest.get(c.categoryid),
    }));
}

function BandIcon({ to, label, src }) {
  return (
    <Link to={to} className="group flex w-[76px] flex-shrink-0 flex-col items-center gap-1.5">
      <span className="block h-[72px] w-[72px] overflow-hidden rounded-xl bg-storefront-border/40 ring-1 ring-storefront-border/70 transition group-hover:ring-2 group-hover:ring-storefront-gold">
        {src && (
          <img
            src={src}
            alt=""
            decoding="async"
            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
          />
        )}
      </span>
      <span className="w-full truncate text-center font-sans text-[11px] leading-tight text-storefront-warm group-hover:text-storefront-gold">
        {label}
      </span>
    </Link>
  );
}

function IconSkeleton() {
  return (
    <div className="flex w-[76px] flex-shrink-0 flex-col items-center gap-1.5" aria-hidden="true">
      <div className="h-[72px] w-[72px] animate-pulse rounded-xl bg-storefront-border/50" />
      <div className="h-2.5 w-12 animate-pulse rounded bg-storefront-border/50" />
    </div>
  );
}

export default function CategoryBand() {
  const [categories, setCategories] = useState(null); // null = loading
  const [images, setImages] = useState({}); // productid -> url

  useEffect(() => {
    let active = true;
    // Two queries for the whole band: names, plus every listed product's
    // category (newest first) to count stock and pick each icon's photo.
    Promise.all([
      supabase.from("categories").select("categoryid, name"),
      supabase.from("products").select("productid, categoryid").order("productid", { ascending: false }),
    ]).then(([catRes, prodRes]) => {
      if (!active) return;
      const picked = pickBandCategories(catRes.data || [], prodRes.data || [], MIN_PRODUCTS);
      setCategories(picked);

      const ids = [DIWALI.productIds[0], ...picked.map((c) => c.newestProductId)];
      Promise.all(ids.map((id) => getProductImageUrl(id, ICON_TRANSFORM))).then((urls) => {
        if (active) setImages(Object.fromEntries(ids.map((id, i) => [id, urls[i]])));
      });
    });
    return () => {
      active = false;
    };
  }, []);

  if (categories && categories.length === 0) return null;

  return (
    <nav aria-label="Shop by category" className="border-b border-storefront-border/70 bg-white">
      <div className="mx-auto max-w-7xl">
        {/* w-max + mx-auto: centred when the row fits, scrollable from the start when it doesn't. */}
        <div className="scrollbar-hide overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-max gap-3 sm:gap-4">
            {categories === null ? (
              Array.from({ length: 10 }).map((_, i) => <IconSkeleton key={i} />)
            ) : (
              <>
                <BandIcon
                  to={`/collections/${DIWALI.slug}`}
                  label={DIWALI.title}
                  src={images[DIWALI.productIds[0]]}
                />
                {/* /shop has no URL category filter yet, so icons open the full shop. */}
                {categories.map((c) => (
                  <BandIcon key={c.categoryid} to="/shop" label={c.name} src={images[c.newestProductId]} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
