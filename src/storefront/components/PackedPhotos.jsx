import React from "react";

// Photos staff took of this order once packed. Renders nothing when there are none.
export default function PackedPhotos({ photos }) {
  if (!photos?.length) return null;
  return (
    <section className="font-sans text-sm text-storefront-charcoal">
      <h2 className="mb-2 font-semibold">Your order, packed</h2>
      <ul className="grid grid-cols-2 gap-2">
        {photos.map((url, index) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Your packed order, view ${index + 1}`}
                loading="lazy"
                className="aspect-square w-full border border-storefront-border object-cover"
              />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
