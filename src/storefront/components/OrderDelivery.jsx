import React from "react";
import { completedStep, courierDisplayName } from "../lib/orderStatus";
import { GOOGLE_REVIEW_URL } from "../lib/siteConfig";

const NOT_ON_ITS_WAY = ["cancelled", "rto", "rto_received"];

function ReviewPrompt() {
  return (
    <p>
      How was your order?{" "}
      <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noopener noreferrer" className="underline">
        Review us on Google
      </a>
    </p>
  );
}

// Who carries a ship order, its tracking number when the shop typed one (a manual delivery handed
// to India Post and the like), and the city it is going to. City and pincode only: /track asks for
// just an order number and a phone number.
export default function OrderDelivery({ status, fulfilment, courierName, trackingNumber, city, pincode }) {
  const delivered = status === "delivered";
  if (fulfilment === "pickup") {
    return delivered ? (
      <div className="font-sans text-sm text-storefront-charcoal">
        <ReviewPrompt />
      </div>
    ) : null;
  }
  if (completedStep(status, fulfilment) < 0) return null;
  const courier = status === "cancelled" ? null : courierDisplayName(courierName);
  const place = NOT_ON_ITS_WAY.includes(status) ? "" : [city, pincode].filter(Boolean).join(", ");
  const tracking = status === "cancelled" ? null : trackingNumber;
  if (!courier && !tracking && !place && !delivered) return null;
  return (
    <div className="font-sans text-sm text-storefront-charcoal space-y-1">
      {courier && <p>Delivery by {courier}</p>}
      {tracking && <p>Tracking number: {tracking}</p>}
      {place && <p>{delivered ? "Delivered to" : "Delivering to"} {place}</p>}
      {delivered && <ReviewPrompt />}
    </div>
  );
}
