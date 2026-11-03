import React from "react";
import { completedStep, formatStepTime, statusMessage, stepTimes, timelineSteps } from "../lib/orderStatus";
import { SHOP_ADDRESS } from "../lib/siteConfig";

const OFF_PATH = {
  cancelled: "This order was cancelled. Any amount paid is being refunded.",
  rto: "The courier is returning this parcel to us. We'll refund the item value once it arrives.",
  rto_received: "This parcel came back to us. The item value is being refunded; shipping is not refundable.",
};

// Order placed → Processed → Packed → Picked up → Out for delivery → Delivered
// for every courier (store pickup: Paid → Ready for pickup → Collected), with
// the cancelled / returned-to-origin exits shown as a note under the steps.
export default function OrderTimeline({ status, fulfilment, statusTimes }) {
  const done = completedStep(status, fulfilment);
  if (done < 0) return null;
  const steps = timelineSteps(fulfilment);
  const times = stepTimes(statusTimes, fulfilment);
  const message = statusMessage(status, fulfilment);
  return (
    <div className="font-sans text-sm text-storefront-charcoal">
      {message && <p className="mb-5 leading-relaxed">{message}</p>}
      {/* Top to bottom on a phone; left to right from md, where six steps fit on one line. */}
      <ol aria-label="Order progress" className="md:flex">
        {steps.map((step, index) => {
          const complete = index <= done;
          // A cancelled or returning order has stopped, so no step is where it is "now".
          const current = index === done && !OFF_PATH[status];
          const time = complete ? formatStepTime(times[index]) : null;
          return (
            <li
              key={step}
              data-complete={complete ? "true" : "false"}
              aria-current={current ? "step" : undefined}
              className="relative flex gap-3 pb-5 last:pb-0 md:flex-1 md:flex-col md:items-center md:gap-2 md:pb-0 md:text-center"
            >
              {index < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  data-testid="timeline-connector"
                  className={`absolute left-3 top-6 bottom-0 w-px -translate-x-1/2 md:left-[calc(50%+0.75rem)] md:top-3 md:bottom-auto md:h-px md:w-[calc(100%-1.5rem)] md:translate-x-0 ${
                    index < done ? "bg-storefront-charcoal" : "bg-storefront-border"
                  }`}
                />
              )}
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
              <span className={`leading-6 ${current ? "font-semibold" : complete ? "" : "text-storefront-muted"}`}>
                {step}
                <span className="sr-only">{complete ? " (done)" : " (pending)"}</span>
                {time && (
                  <time dateTime={times[index]} className="block text-xs font-normal leading-4 text-storefront-muted">
                    {time}
                  </time>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      {fulfilment === "pickup" && status === "ready_for_pickup" && (
        <p className="mt-4 text-sm">
          Your order is ready at our shop: {SHOP_ADDRESS}. Bring your order number.
        </p>
      )}
      {OFF_PATH[status] && <p className="mt-4 text-sm text-red-700">{OFF_PATH[status]}</p>}
    </div>
  );
}
