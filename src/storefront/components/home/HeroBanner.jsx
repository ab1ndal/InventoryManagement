import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export default function HeroBanner() {
  return (
    <section className="relative min-h-[88vh] flex items-center justify-center overflow-hidden bg-storefront-charcoal">
      {/* Subtle gold geometric pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `repeating-linear-gradient(
            45deg,
            #A16207 0px,
            #A16207 1px,
            transparent 1px,
            transparent 60px
          ), repeating-linear-gradient(
            -45deg,
            #A16207 0px,
            #A16207 1px,
            transparent 1px,
            transparent 60px
          )`,
        }}
        aria-hidden="true"
      />

      {/* Warm radial glow */}
      <div
        className="absolute inset-0 opacity-20"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, #44403C, transparent)",
        }}
        aria-hidden="true"
      />

      {/* Content */}
      <div className="relative z-10 text-center px-4 sm:px-8 max-w-4xl mx-auto">
        {/* Gold accent line + eyebrow */}
        <div className="flex items-center justify-center gap-4 mb-6">
          <div className="h-px w-12 bg-storefront-gold" aria-hidden="true" />
          <span className="font-montserrat text-xs tracking-[0.3em] uppercase text-storefront-gold">
            New Collection 2025
          </span>
          <div className="h-px w-12 bg-storefront-gold" aria-hidden="true" />
        </div>

        {/* Main heading */}
        <h1 className="font-cormorant font-semibold text-storefront-cream leading-none mb-2">
          <span className="block text-[clamp(3rem,8vw,6rem)]">
            Timeless Elegance,
          </span>
          <span className="block text-[clamp(3rem,8vw,6rem)] italic text-storefront-gold">
            Modern Grace.
          </span>
        </h1>

        {/* Subtext */}
        <p className="font-montserrat text-sm sm:text-base text-storefront-cream/60 max-w-lg mx-auto mt-6 leading-relaxed tracking-wide">
          Authentic Indian ethnic wear — handcrafted with tradition,
          worn with pride. From radiant sarees to regal lehengas.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-10">
          <Link
            to="/shop"
            className="group inline-flex items-center gap-2 bg-storefront-gold hover:bg-storefront-gold-dark text-white font-montserrat text-sm font-medium tracking-widest uppercase px-8 py-3.5 transition-colors duration-200"
          >
            Explore Collection
            <ArrowRight
              size={15}
              className="group-hover:translate-x-0.5 transition-transform"
            />
          </Link>
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 border border-storefront-cream/40 hover:border-storefront-cream text-storefront-cream font-montserrat text-sm font-medium tracking-widest uppercase px-8 py-3.5 transition-colors duration-200"
          >
            New Arrivals
          </Link>
        </div>

        {/* Trust mini-bar */}
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-12 text-[11px] text-storefront-cream/65 tracking-widest uppercase font-montserrat">
          <span>🌍 Worldwide Shipping</span>
          <span aria-hidden="true" className="text-storefront-gold/60">✦</span>
          <span>100% Authentic</span>
          <span aria-hidden="true" className="text-storefront-gold/60">✦</span>
          <span>Easy Returns</span>
          <span aria-hidden="true" className="text-storefront-gold/60">✦</span>
          <span>Secure Checkout</span>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1.5 animate-bounce">
        <span className="font-montserrat text-[9px] tracking-[0.3em] uppercase text-storefront-cream/40">Scroll</span>
        <svg width="16" height="10" viewBox="0 0 16 10" fill="none" aria-hidden="true">
          <path d="M1 1L8 8L15 1" stroke="#FAFAF9" strokeOpacity="0.4" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>

      {/* Bottom fade into page */}
      <div
        className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-storefront-cream to-transparent"
        aria-hidden="true"
      />
    </section>
  );
}
