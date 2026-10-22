import React from "react";
import { useParams, Link } from "react-router-dom";
import Seo from "../components/Seo";
import { getCollection } from "../lib/collections";
import ShopPage from "./ShopPage";

export default function CollectionPage() {
  const { slug } = useParams();
  const collection = getCollection(slug);

  // Curated lists (Diwali), category and size collections all get the full
  // shop filters; keyed so switching collections starts fresh filters for the new
  // scope. Curated lists default to their curated order.
  if (collection?.productIds?.length || collection?.categoryIds?.length || collection?.sizes?.length) {
    return (
      <ShopPage
        key={slug}
        title={collection.title}
        subtitle={collection.subtitle}
        scopeCategoryIds={collection.productIds ? null : collection.categoryIds}
        scopeProductIds={collection.productIds || null}
        scopeSizes={collection.sizes || null}
      />
    );
  }

  return <EmptyCollection collection={collection} />;
}

// Unknown slugs, and placeholder collections with no membership yet, which
// point to the shop.
function EmptyCollection({ collection }) {
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
      </div>
    </div>
  );
}
