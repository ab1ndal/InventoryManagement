import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { getProductImageUrl } from "../lib/productImage";
import { SUGGEST_GAP_LIMIT, freeShippingProgress } from "../lib/freeShipping";

const SUGGESTION_COUNT = 4;

// Cheapest in-stock pieces that alone close the gap. Filtered inside PostgREST
// (inner embed on variant stock, price floor, limit) because responses are
// silently capped at 1000 rows. The anon RLS policy on `products` already
// hides products without photos, so every suggestion has an image.
function suggestionQuery(gap, cartIds) {
  let query = supabase
    .from("products")
    .select("productid, name, retailprice, productsizecolors!inner(stock)")
    .gt("productsizecolors.stock", 0)
    .gte("retailprice", gap);
  if (cartIds.length)
    query = query.not("productid", "in", `(${cartIds.map((id) => `"${id}"`).join(",")})`);
  return query;
}

// Same categories as the cart first (a saree buyer is shown sarees), then any
// category to fill the row.
async function fetchSuggestions(gap, cartIds) {
  let categoryIds = [];
  if (cartIds.length) {
    const { data, error } = await supabase
      .from("products")
      .select("productid, categoryid")
      .in("productid", cartIds);
    if (error) throw error;
    categoryIds = [...new Set((data ?? []).map((p) => p.categoryid).filter(Boolean))];
  }

  const picks = [];
  const add = (rows) =>
    (rows ?? []).forEach((p) => {
      if (cartIds.includes(p.productid) || picks.some((q) => q.productid === p.productid)) return;
      picks.push(p);
    });

  if (categoryIds.length) {
    const { data, error } = await suggestionQuery(gap, cartIds)
      .in("categoryid", categoryIds)
      .order("retailprice", { ascending: true })
      .limit(SUGGESTION_COUNT);
    if (error) throw error;
    add(data);
  }
  if (picks.length < SUGGESTION_COUNT) {
    const { data, error } = await suggestionQuery(gap, cartIds)
      .order("retailprice", { ascending: true })
      .limit(SUGGESTION_COUNT);
    if (error) throw error;
    add(data);
  }

  const top = picks.slice(0, SUGGESTION_COUNT);
  const images = await Promise.all(
    top.map((p) => getProductImageUrl(p.productid, { width: 150 }))
  );
  return top.map((p, i) => ({ ...p, image_url: images[i] }));
}

function formatRupees(value) {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

export default function FreeShippingNudge({ amount, cartItems = [], onNavigate }) {
  const { qualified, gap, percent } = freeShippingProgress(amount);
  const [suggestions, setSuggestions] = useState([]);
  const wantsSuggestions = amount > 0 && !qualified && gap <= SUGGEST_GAP_LIMIT;
  const cartKey = [...new Set(cartItems.map((i) => i.product_id))].sort().join(",");

  useEffect(() => {
    if (!wantsSuggestions) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const cartIds = cartKey ? cartKey.split(",") : [];
    fetchSuggestions(gap, cartIds)
      .then((rows) => {
        if (active) setSuggestions(rows);
      })
      .catch((error) => {
        console.error("FreeShippingNudge: failed to load suggestions", { gap, cartIds, error });
        if (active) setSuggestions([]);
      });
    return () => {
      active = false;
    };
  }, [wantsSuggestions, gap, cartKey]);

  if (!(amount > 0)) return null;

  if (qualified) {
    return (
      <p className="font-sans text-xs text-storefront-charcoal bg-storefront-cream px-3 py-2">
        You've unlocked free shipping
      </p>
    );
  }

  return (
    <div className="font-sans">
      <p className="text-xs text-storefront-charcoal tabular-nums mb-2">
        Add {formatRupees(gap)} more for free shipping
      </p>
      <div
        role="progressbar"
        aria-label="Progress to free shipping"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-1.5 w-full bg-storefront-border overflow-hidden"
      >
        <div className="h-full bg-storefront-gold transition-all" style={{ width: `${percent}%` }} />
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] tracking-widest uppercase text-storefront-muted mb-2">
            Add one of these
          </p>
          <ul className="grid grid-cols-4 gap-2">
            {suggestions.map((p) => (
              <li key={p.productid} className="min-w-0">
                <Link to={`/product/${p.productid}`} onClick={onNavigate} className="block group">
                  <div className="aspect-[3/4] bg-storefront-cream overflow-hidden mb-1">
                    {p.image_url && (
                      <img
                        src={p.image_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-storefront-charcoal leading-snug line-clamp-1">{p.name}</p>
                  <p className="text-[10px] font-semibold text-storefront-charcoal tabular-nums">
                    {formatRupees(p.retailprice)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
