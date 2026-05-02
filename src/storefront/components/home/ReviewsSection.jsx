import React from "react";
import { Star } from "lucide-react";

// TODO: Replace with real customer testimonials
const REVIEWS = [
  {
    id: 1,
    name: "Priya Sharma",
    location: "Delhi",
    rating: 5,
    text: "The saree I ordered was absolutely stunning — the fabric quality is exceptional and it arrived beautifully packaged. Will definitely be ordering again!",
  },
  {
    id: 2,
    name: "Anjali Mehta",
    location: "Mumbai",
    rating: 4,
    text: "Wore a Bindal's lehenga for my cousin's wedding and received so many compliments. Craftsmanship is beautiful — wish there were more size options.",
  },
  {
    id: 3,
    name: "Deepa Nair",
    location: "Bangalore",
    rating: 5,
    text: "Ordered a salwar suit and the embroidery was even more gorgeous in person than in the photos. Fast shipping too!",
  },
];

function Stars({ count }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={13}
          className={i < count ? "text-storefront-gold fill-storefront-gold" : "text-storefront-border"}
        />
      ))}
    </div>
  );
}

export default function ReviewsSection() {
  return (
    <section className="py-20 bg-white px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
            <span className="font-montserrat text-xs tracking-[0.25em] uppercase text-storefront-gold">
              Testimonials
            </span>
            <div className="h-px w-8 bg-storefront-gold/50" aria-hidden="true" />
          </div>
          <h2 className="font-cormorant font-semibold text-4xl sm:text-5xl text-storefront-charcoal">
            What Our Customers Say
          </h2>
        </div>

        {/* Reviews grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {REVIEWS.map((r) => (
            <div
              key={r.id}
              className="bg-storefront-cream rounded-sm p-7 border border-storefront-border flex flex-col gap-4"
            >
              <Stars count={r.rating} />
              <p className="font-montserrat text-sm text-storefront-warm leading-relaxed italic">
                "{r.text}"
              </p>
              <div className="mt-auto pt-3 border-t border-storefront-border">
                <p className="font-cormorant font-semibold text-storefront-charcoal text-lg leading-none">
                  {r.name}
                </p>
                <p className="font-montserrat text-xs text-storefront-muted mt-0.5">
                  {r.location}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
