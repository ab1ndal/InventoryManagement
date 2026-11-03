import React from "react";
import { completedStep, courierDisplayName } from "../lib/orderStatus";

const NOT_ON_ITS_WAY = ["cancelled", "rto", "rto_received"];

// Who carries a ship order and the city it is going to. City and pincode only: /track
// asks for just an order number and a phone number.
export default function OrderDelivery({ status, fulfilment, courierName, city, pincode }) {
  if (fulfilment === "pickup" || completedStep(status, fulfilment) < 0) return null;
  const courier = status === "cancelled" ? null : courierDisplayName(courierName);
  const place = NOT_ON_ITS_WAY.includes(status) ? "" : [city, pincode].filter(Boolean).join(", ");
  if (!courier && !place) return null;
  return (
    <div className="font-sans text-sm text-storefront-charcoal space-y-1">
      {courier && <p>Delivery by {courier}</p>}
      {place && <p>{status === "delivered" ? "Delivered to" : "Delivering to"} {place}</p>}
    </div>
  );
}
