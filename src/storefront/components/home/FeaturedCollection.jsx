import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export default function FeaturedCollection() {
  return (
    <section className="py-20 bg-storefront-cream">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-sm bg-storefront-charcoal min-h-[420px] flex items-center">
          {/* Background pattern */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage: `repeating-linear-gradient(0deg, #A16207 0px, #A16207 1px, transparent 1px, transparent 48px),
                repeating-linear-gradient(90deg, #A16207 0px, #A16207 1px, transparent 1px, transparent 48px)`,
            }}
            aria-hidden="true"
          />

          {/* Gold border inset */}
          <div
            className="absolute inset-4 border border-storefront-gold/20 pointer-events-none"
            aria-hidden="true"
          />

          {/* Content split */}
          <div className="relative z-10 w-full grid grid-cols-1 lg:grid-cols-2 gap-10 p-10 sm:p-14">
            {/* Left: text */}
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-5">
                <div className="h-px w-8 bg-storefront-gold" aria-hidden="true" />
                <span className="font-sans text-xs tracking-[0.3em] uppercase text-storefront-gold">
                  Featured Edit
                </span>
              </div>
              <h2 className="font-display font-semibold text-storefront-cream text-[clamp(2.25rem,5vw,4rem)] leading-tight mb-4">
                The Bridal<br />
                <span className="italic text-storefront-gold">Edit 2025</span>
              </h2>
              <p className="font-sans text-sm text-storefront-cream/60 leading-relaxed max-w-sm mb-8">
                Exquisite lehengas, bridal sarees, and shararas — each piece tells
                a story of artistry passed down through generations.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/shop"
                  className="group inline-flex items-center gap-2 bg-storefront-gold hover:bg-storefront-gold-dark text-white font-sans text-sm font-medium tracking-widest uppercase px-7 py-3 transition-colors duration-200"
                >
                  Shop Bridal
                  <ArrowRight
                    size={14}
                    className="group-hover:translate-x-0.5 transition-transform"
                  />
                </Link>
              </div>
            </div>

            {/* Right: decorative stat blocks */}
            <div className="hidden lg:flex flex-col justify-center gap-6">
              {[
                { number: "500+", label: "Handcrafted designs" },
                { number: "25+", label: "Years of heritage" },
                { number: "10k+", label: "Happy brides" },
              ].map(({ number, label }) => (
                <div key={label} className="flex items-center gap-5">
                  <div className="h-px w-8 bg-storefront-gold/40" aria-hidden="true" />
                  <div>
                    <div className="font-display font-semibold text-3xl text-storefront-gold">
                      {number}
                    </div>
                    <div className="font-sans text-xs text-storefront-cream/50 tracking-wider uppercase">
                      {label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
