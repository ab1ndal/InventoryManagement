import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import Seo from "../components/Seo";
import ProductCard from "../components/ProductCard";
import { getCollection } from "../lib/collections";
import ShopPage from "./ShopPage";

const PRODUCT_COLUMNS = "productid, name, retailprice, producturl, fabric, categoryid, categories(name), productsizecolors(stock)";

export default function CollectionPage() {
  const { slug } = useParams();
  const collection = getCollection(slug);

  // Category collections get the full shop filters; keyed so switching
  // categories starts fresh filters for the new scope.
  if (collection && !collection.productIds && collection.categoryIds?.length) {
    return (
      <ShopPage
        key={slug}
        title={collection.title}
        subtitle={collection.subtitle}
        scopeCategoryIds={collection.categoryIds}
      />
    );
  }

  return <CuratedCollection slug={slug} collection={collection} />;
}

// Hand-picked lists (Diwali) keep their curated order, and empty placeholder
// collections show a pointer to the shop.
function CuratedCollection({ slug, collection }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!collection) {
      setLoading(false);
      return;
    }

    const { productIds } = collection;
    if (productIds?.length) {
      supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .in("productid", productIds)
        .then(({ data }) => {
          // `in` returns rows in database order; show them in the curated order.
          const rank = new Map(productIds.map((id, i) => [id, i]));
          setProducts((data || []).slice().sort((a, b) => rank.get(a.productid) - rank.get(b.productid)));
          setLoading(false);
        });
    } else {
      setProducts([]);
      setLoading(false);
    }
  }, [collection, slug]);

  if (!collection) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Seo title="Collection not found" noindex />
        <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">
          Collection not found
        </h1>
        <Link
          to="/collections"
          className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline"
        >
          Browse all collections
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-storefront-cream">
      <Seo title={collection.title} description={collection.subtitle} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 text-center">
        <h1 className="font-display font-semibold text-4xl sm:text-5xl text-storefront-charcoal leading-tight mb-3">
          {collection.title}
        </h1>
        {collection.subtitle && (
          <p className="font-sans text-sm text-storefront-muted">{collection.subtitle}</p>
        )}
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-14">
        {loading ? null : products.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-sans text-sm text-storefront-charcoal mb-4">
              Curated pieces coming soon — browse the full shop.
            </p>
            <Link
              to="/shop"
              className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline"
            >
              Browse the full shop
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-5">
            {products.map((p, i) => (
              <ProductCard key={p.productid} product={p} priority={i < 4} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
