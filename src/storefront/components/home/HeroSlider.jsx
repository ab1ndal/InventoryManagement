import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { getProductImageUrl } from "../../lib/productImage";
import { HERO_SLIDES } from "../../lib/heroSlides";

const AUTOPLAY_MS = 5000;
const SWIPE_THRESHOLD_PX = 40;
// Width must be whitelisted in vercel.json images.sizes.
const IMAGE_TRANSFORM = { width: 1000 };

// Read once on mount. matchMedia is absent in some non-browser environments.
function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Resolve every { productid } image to its first photo in one batched pass.
// Returns a lookup: image config -> src (null until resolved).
function useImageSources(slides) {
  const [byProduct, setByProduct] = useState({});

  useEffect(() => {
    let active = true;
    const ids = [
      ...new Set(slides.flatMap((s) => s.images.map((img) => img.productid)).filter(Boolean)),
    ];
    Promise.all(ids.map((id) => getProductImageUrl(id, IMAGE_TRANSFORM))).then((urls) => {
      if (!active) return;
      setByProduct(Object.fromEntries(ids.map((id, i) => [id, urls[i]])));
    });
    return () => {
      active = false;
    };
  }, [slides]);

  return (img) => img.url || byProduct[img.productid] || null;
}

function SlideImage({ src, className = "" }) {
  if (!src) return <div className={`bg-storefront-gold/10 ${className}`} />;
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      className={`object-cover object-top ${className}`}
    />
  );
}

function Slide({ slide, index, count, active, srcFor }) {
  // Several product photos -> side-by-side panel on desktop; one image -> full-bleed.
  const panel = slide.images.length > 1;

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${count}: ${slide.headline}`}
      aria-hidden={!active}
      inert={!active}
      className={`absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none ${
        active ? "opacity-100 z-10" : "opacity-0 z-0"
      }`}
    >
      {/* Gold-tinted cream backdrop makes square product photos look intentional. */}
      <div className="absolute inset-0 bg-storefront-cream" aria-hidden="true">
        <div className="absolute inset-0 bg-storefront-gold/[0.08]" />
      </div>

      {/* Full-bleed lead image: always on mobile, on desktop only for single-image slides. */}
      <SlideImage
        src={srcFor(slide.images[0])}
        className={`absolute inset-0 h-full w-full ${panel ? "md:hidden" : ""}`}
      />

      {panel && (
        <div className="hidden md:flex absolute inset-y-0 right-0 w-[60%] gap-3 py-6 pr-6 lg:gap-4 lg:py-8 lg:pr-8">
          {slide.images.map((img, i) => (
            <div
              key={img.productid || img.url}
              className={`relative flex-1 overflow-hidden rounded-sm bg-white ${i > 1 ? "hidden lg:block" : ""}`}
            >
              <SlideImage src={srcFor(img)} className="absolute inset-0 h-full w-full" />
            </div>
          ))}
        </div>
      )}

      {/* Scrims keep overlaid text readable on photos. */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent md:hidden"
        aria-hidden="true"
      />
      {!panel && (
        <div
          className="hidden md:block absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent"
          aria-hidden="true"
        />
      )}

      <div
        className={`absolute inset-x-0 bottom-0 px-6 pb-14 text-white md:inset-y-0 md:right-auto md:flex md:w-[40%] md:flex-col md:justify-center md:px-10 md:pb-0 lg:px-16 ${
          panel ? "md:text-storefront-charcoal" : ""
        }`}
      >
        <h2 className="font-display font-semibold leading-[1.05] text-[clamp(2rem,4.2vw,3.5rem)] text-inherit">
          {slide.headline}
        </h2>
        <p
          className={`mt-3 max-w-sm font-sans text-sm leading-relaxed sm:text-base ${
            panel ? "text-white/85 md:text-storefront-warm" : "text-white/85"
          }`}
        >
          {slide.subline}
        </p>
        <div className="mt-6">
          <Link
            to={slide.href}
            className="group inline-flex items-center gap-2 bg-storefront-gold px-7 py-3 font-sans text-xs font-medium uppercase tracking-widest text-white transition-colors hover:bg-storefront-gold-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-storefront-gold"
          >
            {slide.cta}
            <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}

// Below lg, arrows would collide with the copy; touch/tablet use swipe and dots.
const arrowClass =
  "absolute top-1/2 z-20 -translate-y-1/2 hidden lg:flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-storefront-charcoal shadow-sm transition-colors hover:bg-white hover:text-storefront-gold cursor-pointer";

export default function HeroSlider({ slides = HERO_SLIDES }) {
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion] = useState(prefersReducedMotion);
  const touchStart = useRef(null);
  const srcFor = useImageSources(slides);

  const autoplaying = !paused && !reducedMotion && count > 1;

  // Re-armed on every slide change, so manual navigation restarts the clock.
  useEffect(() => {
    if (!autoplaying) return undefined;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [autoplaying, index, count]);

  const go = (dir) => setIndex((i) => (i + dir + count) % count);

  function onTouchStart(e) {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  }

  function onTouchEnd(e) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    go(dx < 0 ? 1 : -1);
  }

  if (count === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured collections"
      className="relative w-full aspect-[4/5] overflow-hidden bg-storefront-cream md:aspect-[2.6/1] md:max-h-[520px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div aria-live={autoplaying ? "off" : "polite"} className="absolute inset-0">
        {slides.map((slide, i) => (
          <Slide
            key={slide.id}
            slide={slide}
            index={i}
            count={count}
            active={i === index}
            srcFor={srcFor}
          />
        ))}
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous slide"
            className={`${arrowClass} left-3 md:left-5`}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next slide"
            className={`${arrowClass} right-3 md:right-5`}
          >
            <ChevronRight size={20} aria-hidden="true" />
          </button>

          <div className="absolute inset-x-0 bottom-4 z-20 flex justify-center gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === index ? "true" : undefined}
                className="flex h-6 items-center cursor-pointer"
              >
                <span
                  className={`block h-1 rounded-full transition-all duration-300 ${
                    i === index ? "w-7 bg-storefront-gold" : "w-3 bg-white/80 ring-1 ring-black/10"
                  }`}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
