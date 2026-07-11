import React from "react";
import { Link } from "react-router-dom";
import Seo from "../components/Seo";
import { useWishlist } from "../context/WishlistContext";
import ProductCard from "../components/ProductCard";

export default function WishlistPage() {
  const { items } = useWishlist();

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <Seo title="Wishlist" noindex />
        <h1 className="font-display text-2xl font-semibold text-storefront-charcoal mb-3">
          No saved items yet
        </h1>
        <Link to="/shop" className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
          Continue shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Seo title="Wishlist" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-8">Your wishlist</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
        {items.map((i) => (
          <ProductCard key={i.productid} product={i} />
        ))}
      </div>
    </div>
  );
}
