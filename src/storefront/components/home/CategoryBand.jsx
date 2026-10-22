import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../../lib/productImage";
import { COLLECTIONS, getCollection } from "../../lib/collections";
import { NAV_LINKS } from "../../lib/siteConfig";

// Icons render at 72px; 150 is the nearest whitelisted width for 2x screens.
const ICON_TRANSFORM = { width: 150 };

const DIWALI = getCollection("diwali");

/**
 * The band mirrors the header's category links (same labels, same collection
 * pages), each illustrated by the newest product in that collection.
 * @param {{label:string,to:string}[]} links  header nav links, in display order
 * @param {{slug:string,categoryIds?:string[]}[]} collections
 * @param {{productid:string,categoryid:string}[]} products  newest first
 * @returns {{label:string,to:string,newestProductId:string}[]} links with at least one product
 */
export function pickBandEntries(links, collections, products) {
  const newestByCategory = new Map();
  for (const { productid, categoryid } of products) {
    if (!newestByCategory.has(categoryid)) newestByCategory.set(categoryid, productid);
  }
  const bySlug = new Map(collections.map((c) => [c.slug, c]));
  return links.flatMap(({ label, to }) => {
    const collection = bySlug.get(to.replace("/collections/", ""));
    if (!to.startsWith("/collections/") || !collection?.categoryIds?.length) return [];
    // Newest across the collection's categories: products are newest first,
    // so the first product in any of its categories wins.
    const ids = new Set(collection.categoryIds);
    const newest = products.find((p) => ids.has(p.categoryid));
    return newest ? [{ label, to, newestProductId: newest.productid }] : [];
  });
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
  const [entries, setEntries] = useState(null); // null = loading
  const [images, setImages] = useState({}); // productid -> url

  useEffect(() => {
    let active = true;
    // One query for the whole band: every listed product's category, newest
    // first, to pick each icon's photo.
    supabase
      .from("products")
      .select("productid, categoryid")
      .order("productid", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        const picked = pickBandEntries(NAV_LINKS, COLLECTIONS, data || []);
        setEntries(picked);

        const ids = [DIWALI.productIds[0], ...picked.map((e) => e.newestProductId)];
        Promise.all(ids.map((id) => getProductImageUrl(id, ICON_TRANSFORM))).then((urls) => {
          if (active) setImages(Object.fromEntries(ids.map((id, i) => [id, urls[i]])));
        });
      });
    return () => {
      active = false;
    };
  }, []);

  if (entries && entries.length === 0) return null;

  return (
    // Phones only: from md up the header's text category row shows the same
    // links, and the two stacked read as a repeat.
    <nav aria-label="Shop by category" className="md:hidden border-b border-storefront-border/70 bg-white">
      <div className="mx-auto max-w-7xl">
        {/* w-max + mx-auto: centred when the row fits, scrollable from the start when it doesn't. */}
        <div className="scrollbar-hide overflow-x-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex w-max gap-3 sm:gap-4">
            {entries === null ? (
              Array.from({ length: 10 }).map((_, i) => <IconSkeleton key={i} />)
            ) : (
              <>
                <BandIcon
                  to={`/collections/${DIWALI.slug}`}
                  label={DIWALI.title}
                  src={images[DIWALI.productIds[0]]}
                />
                {entries.map((e) => (
                  <BandIcon key={e.to} to={e.to} label={e.label} src={images[e.newestProductId]} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
