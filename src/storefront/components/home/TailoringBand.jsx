import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

// Home band for custom tailoring, the shop's main differentiator (owner
// 2026-10-25). Sits right after the Diwali rail so it is seen early. Its photo
// must differ from the one on /customize (owner: repeating it looked odd).
export default function TailoringBand() {
  return (
    <section className="bg-[#F2ECE3]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 sm:py-20 grid grid-cols-1 md:grid-cols-[0.85fr_1.15fr] gap-8 md:gap-14 items-center">
        <img
          src="/customize/photo-to-sketch.webp"
          alt="A lehenga on a phone screen, next to a pencil sketch of the same design and matching fabric swatches"
          width={900}
          height={1125}
          loading="lazy"
          decoding="async"
          className="w-full max-w-md md:max-w-none aspect-[4/5] md:aspect-[4/4.4] object-cover rounded-sm"
        />
        <div>
          <h2 className="font-display font-semibold text-storefront-charcoal text-[clamp(2.2rem,4.5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] [text-wrap:balance] mb-5">
            Seen a look you love? We&apos;ll make it.
          </h2>
          <p className="font-sans text-base text-storefront-warm leading-relaxed max-w-lg mb-3">
            A film star&apos;s lehenga, a look from Instagram, a photo from a wedding. Send us the picture and our
            in-house tailors will make it in your size.
          </p>
          <p className="font-display italic text-lg text-storefront-gold mb-8">
            Not something like it. The one in your photo.
          </p>
          <Link
            to="/customize"
            className="group inline-flex items-center gap-2 bg-storefront-charcoal hover:bg-storefront-warm text-storefront-cream font-sans text-sm font-medium tracking-widest uppercase px-8 py-4 active:scale-[0.98] transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-storefront-gold focus-visible:ring-offset-2"
          >
            How custom tailoring works
            <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </div>
    </section>
  );
}
