import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { supabase } from "lib/supabaseClient";

// Curated images per category keyword — onError falls back to gradient
const IMAGE_MAP = [
  {
    match: "saree",
    url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "lehenga",
    url: "https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "salwar",
    url: "https://images.unsplash.com/photo-1617196034282-8f93b79c5d24?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "kurti",
    url: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "dupatta",
    url: "https://images.unsplash.com/photo-1614093302611-4b0dff45ba25?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "bridal",
    url: "https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "suit",
    url: "https://images.unsplash.com/photo-1617196034183-421b4040ed20?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "anarkali",
    url: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "sharara",
    url: "https://images.unsplash.com/photo-1583391733956-6c78276477e2?auto=format&fit=crop&w=400&q=85",
  },
  {
    match: "ethnic",
    url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=400&q=85",
  },
];

const GRADIENT_FALLBACKS = [
  "from-[#2C1810] to-storefront-charcoal",
  "from-storefront-charcoal to-storefront-warm",
  "from-[#1a2420] to-storefront-charcoal",
  "from-storefront-warm to-[#2C1810]",
  "from-[#241a10] to-storefront-charcoal",
  "from-storefront-charcoal to-[#1a1614]",
];

function getImage(name) {
  const lower = name.toLowerCase();
  return IMAGE_MAP.find(({ match }) => lower.includes(match))?.url ?? null;
}

// Card dimensions: original w-44 (176px) × aspect 2/3 (264px tall)
// 20% narrower → 141px wide
// 50% taller   → 396px tall
// aspect-ratio: 141/396
const CARD_W = 141;
const CARD_ASPECT = "141 / 396";

function CategoryCard({ category, index }) {
  const [imgFailed, setImgFailed] = useState(false);
  const imageUrl = getImage(category.name);
  const gradient = GRADIENT_FALLBACKS[index % GRADIENT_FALLBACKS.length];

  return (
    <Link
      to={`/shop?category=${category.categoryid}`}
      className="group relative flex-shrink-0 overflow-hidden"
      style={{ width: CARD_W, aspectRatio: CARD_ASPECT }}
    >
      {/* Background image or gradient */}
      {imageUrl && !imgFailed ? (
        <img
          src={imageUrl}
          alt={category.name}
          onError={() => setImgFailed(true)}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.06] transition-transform duration-700 ease-out"
        />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-b ${gradient}`} />
      )}

      {/* Permanent soft vignette so text is always readable when revealed */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50" />

      {/* Hover darkening */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors duration-400" />

      {/* Name — hidden by default, reveals top→down on hover via clip-path */}
      <div className="absolute inset-0 flex items-center justify-center px-3">
        <h3 className="font-cormorant font-semibold text-white text-2xl leading-tight text-center tracking-wide transition-[clip-path] duration-500 ease-out [clip-path:inset(0_0_100%_0)] group-hover:[clip-path:inset(0_0_0%_0)]">
          {category.name}
        </h3>
      </div>

      {/* Gold bottom accent line — grows on hover */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-storefront-gold scale-x-0 group-hover:scale-x-100 transition-transform duration-500 ease-out origin-left" />
    </Link>
  );
}

function CategorySkeleton() {
  return (
    <div
      className="flex-shrink-0 bg-storefront-charcoal/10 animate-pulse"
      style={{ width: CARD_W, aspectRatio: CARD_ASPECT }}
    />
  );
}

export default function CategoryShowcase() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const sectionRef = useRef(null);
  const scrollRef = useRef(null);
  const posRef = useRef(0);
  const velocityRef = useRef(0);
  const rafRef = useRef(null);

  // Fetch categories ordered by product count (most stocked first)
  useEffect(() => {
    Promise.all([
      supabase.from("categories").select("categoryid, name, description"),
      supabase.from("products").select("categoryid"),
    ]).then(([catRes, prodRes]) => {
      const cats = catRes.data || [];
      const prods = prodRes.data || [];
      const countMap = {};
      prods.forEach(({ categoryid }) => {
        countMap[categoryid] = (countMap[categoryid] || 0) + 1;
      });
      const sorted = [...cats]
        .filter((c) => (countMap[c.categoryid] || 0) >= 10)
        .sort(
          (a, b) =>
            (countMap[b.categoryid] || 0) - (countMap[a.categoryid] || 0),
        );
      setCategories(sorted);
      setLoading(false);
    });
  }, []);

  // Horizontal wheel on the section drives carousel; vertical scroll ignored
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    function onWheel(e) {
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!isHorizontal) return;
      e.preventDefault(); // stop browser from navigating back/forward
      velocityRef.current += e.deltaX * 0.6;
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // RAF: apply velocity with smooth Lenis-style exponential decay
  useEffect(() => {
    if (loading || categories.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    function tick() {
      if (Math.abs(velocityRef.current) > 0.05) {
        posRef.current += velocityRef.current;
        velocityRef.current *= 0.88; // decay — higher = more glide

        const halfWidth = el.scrollWidth / 2;
        posRef.current = ((posRef.current % halfWidth) + halfWidth) % halfWidth;
        el.scrollLeft = posRef.current;
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loading, categories]);

  const items = categories.length > 0 ? [...categories, ...categories] : [];

  return (
    <section ref={sectionRef} className="py-16 bg-storefront-cream">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          <span className="font-montserrat text-xs tracking-[0.25em] uppercase text-storefront-gold">
            Explore
          </span>
        </div>
        <h2 className="font-cormorant font-semibold text-3xl sm:text-4xl text-storefront-charcoal">
          Shop by Category
        </h2>
      </div>

      {/* Full-bleed carousel — no gap, no overflow scrollbar */}
      <div
        ref={scrollRef}
        className="flex overflow-x-hidden"
        style={{ userSelect: "none" }}
      >
        {loading
          ? Array.from({ length: 10 }).map((_, i) => (
              <CategorySkeleton key={i} />
            ))
          : items.map((cat, i) => (
              <CategoryCard
                key={`${cat.categoryid}-${i}`}
                category={cat}
                index={i}
              />
            ))}
      </div>

      {/* Scroll hint */}
      <p className="text-center font-montserrat text-[10px] tracking-[0.25em] uppercase text-storefront-muted/60 mt-5">
        Scroll to explore
      </p>
    </section>
  );
}
