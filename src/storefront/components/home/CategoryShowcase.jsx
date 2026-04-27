import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import { ArrowRight } from "lucide-react";

const GRADIENT_VARIANTS = [
  "from-storefront-charcoal to-storefront-warm",
  "from-storefront-warm to-storefront-charcoal",
  "from-[#2C1810] to-storefront-charcoal",
  "from-storefront-charcoal to-[#1a1614]",
  "from-[#1a2420] to-storefront-charcoal",
  "from-storefront-charcoal to-[#241a10]",
];

function CategoryCard({ category, index }) {
  const gradient = GRADIENT_VARIANTS[index % GRADIENT_VARIANTS.length];

  return (
    <Link
      to={`/shop?category=${category.categoryid}`}
      className={`group relative overflow-hidden aspect-[4/5] rounded-sm bg-gradient-to-br ${gradient} flex items-end p-5 hover:shadow-xl transition-all duration-300`}
    >
      {/* Gold corner ornament */}
      <div
        className="absolute top-3 right-3 w-6 h-6 border-t border-r border-storefront-gold/30 group-hover:border-storefront-gold/60 transition-colors"
        aria-hidden="true"
      />
      <div
        className="absolute bottom-3 left-3 w-6 h-6 border-b border-l border-storefront-gold/30 group-hover:border-storefront-gold/60 transition-colors"
        aria-hidden="true"
      />

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-storefront-gold/0 group-hover:bg-storefront-gold/5 transition-colors duration-300" />

      {/* Text */}
      <div className="relative z-10">
        <h3 className="font-cormorant font-semibold text-storefront-cream text-2xl leading-tight mb-1">
          {category.name}
        </h3>
        {category.description && (
          <p className="font-montserrat text-[11px] text-storefront-cream/50 tracking-wide mb-3 line-clamp-1">
            {category.description}
          </p>
        )}
        <span className="inline-flex items-center gap-1.5 font-montserrat text-[11px] tracking-widest uppercase text-storefront-gold group-hover:gap-2.5 transition-all duration-200">
          Shop Now <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}

function CategorySkeleton() {
  return (
    <div className="aspect-[4/5] rounded-sm bg-storefront-charcoal/10 animate-pulse" />
  );
}

export default function CategoryShowcase() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("categories")
      .select("categoryid, name, description")
      .order("name")
      .then(({ data }) => {
        setCategories(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      {/* Section header */}
      <div className="text-center mb-12">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-montserrat text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Explore
          </span>
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
        </div>
        <h2 className="font-cormorant font-semibold text-4xl sm:text-5xl text-storefront-charcoal">
          Shop by Category
        </h2>
        <p className="font-montserrat text-sm text-storefront-muted mt-3 max-w-md mx-auto">
          Curated collections for every occasion — from everyday elegance to grand celebrations.
        </p>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <CategorySkeleton key={i} />
            ))
          : categories.map((cat, i) => (
              <CategoryCard key={cat.categoryid} category={cat} index={i} />
            ))}
      </div>

      {!loading && categories.length === 0 && (
        <p className="text-center text-storefront-muted font-montserrat text-sm py-12">
          Categories coming soon.
        </p>
      )}
    </section>
  );
}
