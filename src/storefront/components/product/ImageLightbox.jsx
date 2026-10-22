import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { imageUrl } from "../../lib/productImage";

// Full-screen, uncropped view of the gallery. Controlled by the PDP so the
// lightbox and the page gallery stay on the same photo.
export default function ImageLightbox({ open, onOpenChange, paths, index, onIndexChange, name }) {
  const count = paths.length;
  if (count === 0) return null;
  const hasMany = count > 1;
  const step = (dir) => onIndexChange((index + dir + count) % count);

  function onKeyDown(e) {
    if (!hasMany) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  }

  const navButton =
    "absolute top-1/2 -translate-y-1/2 p-3 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 transition-colors cursor-pointer";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-storefront-charcoal/95" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-12 focus:outline-none"
        >
          <Dialog.Title className="sr-only">{name}</Dialog.Title>
          <img
            key={paths[index]}
            src={imageUrl(paths[index], { width: 1200 })}
            alt={`${name} — view ${index + 1} of ${count}`}
            className="max-w-full max-h-full object-contain"
          />
          {hasMany && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => step(-1)}
                className={`${navButton} left-2 sm:left-6`}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => step(1)}
                className={`${navButton} right-2 sm:right-6`}
              >
                <ChevronRight size={22} />
              </button>
              <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs font-sans tracking-wide tabular-nums">
                {index + 1} / {count}
              </span>
            </>
          )}
          <Dialog.Close
            aria-label="Close"
            className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 text-white/80 hover:text-white cursor-pointer"
          >
            <X size={22} />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
