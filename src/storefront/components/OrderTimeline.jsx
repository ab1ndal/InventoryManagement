import React from "react";
import { TIMELINE_STEPS, completedStep } from "../lib/orderStatus";

const OFF_PATH = {
  cancelled: "This order was cancelled. Any amount paid is being refunded.",
  rto: "The courier is returning this parcel to us. We'll refund the item value once it arrives.",
  rto_received: "This parcel came back to us. The item value is being refunded; shipping is not refundable.",
};

// Paid → Packed → Shipped → Out for delivery → Delivered, with the
// cancelled / returned-to-origin exits shown as a note under the steps.
export default function OrderTimeline({ status }) {
  const done = completedStep(status);
  if (done < 0) return null;
  return (
    <div className="font-sans text-sm text-storefront-charcoal">
      <ol aria-label="Order progress" className="flex flex-col sm:flex-row sm:justify-between gap-3 sm:gap-2">
        {TIMELINE_STEPS.map((step, index) => {
          const complete = index <= done;
          return (
            <li key={step} data-complete={complete ? "true" : "false"} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  complete
                    ? "border-storefront-charcoal bg-storefront-charcoal text-storefront-cream"
                    : "border-storefront-border text-storefront-muted"
                }`}
              >
                {complete ? "✓" : index + 1}
              </span>
              <span className={complete ? "" : "text-storefront-muted"}>
                {step}
                <span className="sr-only">{complete ? " (done)" : " (pending)"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {OFF_PATH[status] && <p className="mt-4 text-sm text-red-700">{OFF_PATH[status]}</p>}
    </div>
  );
}
