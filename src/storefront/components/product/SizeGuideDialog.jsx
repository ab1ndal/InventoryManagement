import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Ruler, X } from "lucide-react";
import { SizeGuideIntro, SizeGuideTable, SizeGuideHelp } from "./SizeGuideBody";

// Opens the size guide over the product page so shoppers keep their place
// (and their selected size) instead of navigating away to /size-guide.
export default function SizeGuideDialog() {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-sans text-storefront-charcoal underline underline-offset-4 decoration-storefront-border hover:text-storefront-gold hover:decoration-storefront-gold transition-colors cursor-pointer"
        >
          <Ruler size={13} aria-hidden="true" />
          Size guide
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-storefront-charcoal/60 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-lg max-h-[85vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2 bg-white p-6 sm:p-8 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-4 mb-6">
            <Dialog.Title className="font-display text-2xl font-semibold text-storefront-charcoal">
              Size guide
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close size guide"
              className="p-1.5 -mr-1.5 text-storefront-muted hover:text-storefront-charcoal transition-colors cursor-pointer"
            >
              <X size={18} />
            </Dialog.Close>
          </div>
          <SizeGuideIntro />
          <SizeGuideTable />
          <SizeGuideHelp />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
