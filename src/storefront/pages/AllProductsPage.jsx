import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import StaticPage from "../components/StaticPage";
import {
  ALL_PRODUCTS_DESCRIPTION,
  ALL_PRODUCTS_PAGE,
  ALL_PRODUCTS_TITLE,
} from "./allProductsContent";

async function fetchAllProducts() {
  const products = [];
  for (let from = 0; ; from += ALL_PRODUCTS_PAGE) {
    const { data, error } = await supabase
      .from("products")
      .select("productid, name:display_title")
      .order("productid", { ascending: false })
      .range(from, from + ALL_PRODUCTS_PAGE - 1);
    if (error) throw error;
    products.push(...data);
    if (data.length < ALL_PRODUCTS_PAGE) return products;
  }
}

// A plain list of every product. The shop grid loads more only on scroll, so without this most
// products have no link a search crawler can follow.
export default function AllProductsPage() {
  const [products, setProducts] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let superseded = false;
    fetchAllProducts()
      .then((rows) => {
        if (!superseded) setProducts(rows);
      })
      .catch((err) => {
        console.error("[AllProductsPage] load failed:", err.message);
        if (!superseded) setFailed(true);
      });
    return () => {
      superseded = true;
    };
  }, []);

  return (
    <StaticPage
      title={ALL_PRODUCTS_TITLE}
      seoDescription={ALL_PRODUCTS_DESCRIPTION}
      containerClassName="max-w-6xl"
    >
      <p className="mb-8 text-sm text-storefront-muted font-sans">{ALL_PRODUCTS_DESCRIPTION}</p>
      {failed && (
        <p className="text-sm text-storefront-muted font-sans">
          This list could not load.{" "}
          <Link to="/shop" className="underline">
            Browse the shop
          </Link>{" "}
          instead.
        </p>
      )}
      {!failed && !products && <p className="text-sm text-storefront-muted font-sans">Loading…</p>}
      {products && (
        <ul className="grid gap-x-6 gap-y-2 text-sm font-sans sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <li key={p.productid}>
              <Link to={`/product/${encodeURIComponent(p.productid)}`} className="hover:underline">
                {p.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </StaticPage>
  );
}
