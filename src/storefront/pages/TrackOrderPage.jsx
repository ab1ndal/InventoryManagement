import React, { useState } from "react";
import Seo from "../components/Seo";
import OrderDetails from "../components/OrderDetails";
import OrderTimeline from "../components/OrderTimeline";
import { WHATSAPP_URL, lookupOrder } from "../lib/ordersApi";
import { statusLabel } from "../lib/orderStatus";

export default function TrackOrderPage() {
  const [orderRef, setOrderRef] = useState("");
  const [phone, setPhone] = useState("");
  // idle | loading | found | not_found | error
  const [result, setResult] = useState({ kind: "idle", order: null });

  async function onSubmit(e) {
    e.preventDefault();
    setResult({ kind: "loading", order: null });
    try {
      const order = await lookupOrder(orderRef.trim(), phone.trim());
      setResult(order ? { kind: "found", order } : { kind: "not_found", order: null });
    } catch (error) {
      console.warn("online_order_lookup failed", { orderRef, message: error.message });
      setResult({ kind: "error", order: null });
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-16">
      <Seo title="Track order" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">
        Track your order
      </h1>

      {result.kind === "found" ? (
        <div className="space-y-6 mt-6">
          <div className="text-sm font-sans text-storefront-charcoal">
            <p className="text-xs tracking-widest uppercase text-storefront-muted">Order {result.order.orderRef}</p>
            <p className="text-lg font-semibold mt-1">{statusLabel(result.order.status, result.order.fulfilment)}</p>
          </div>
          <OrderTimeline status={result.order.status} fulfilment={result.order.fulfilment} />
          {result.order.fulfilment !== "pickup" && result.order.trackingUrl && (
            <a href={result.order.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-sans underline">
              {result.order.courier === "porter" ? "Track with Porter" : "Track with the courier"}
            </a>
          )}
          <OrderDetails order={result.order} />
          <button
            type="button"
            onClick={() => setResult({ kind: "idle", order: null })}
            className="text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline"
          >
            Track another order
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-2"
              htmlFor="orderRef"
            >
              Order Reference
            </label>
            <input
              id="orderRef"
              type="text"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              placeholder="WEB-000123"
              className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>

          <div>
            <label
              className="block text-xs font-sans tracking-wide text-storefront-charcoal mb-2"
              htmlFor="phone"
            >
              Phone
            </label>
            <input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full border border-storefront-border bg-white px-3 py-3 text-sm font-sans focus:outline-none focus:border-storefront-gold"
            />
          </div>

          {result.kind === "not_found" && (
            <p role="alert" className="text-sm font-sans text-red-600">
              We couldn't find that order. Check the order number and the phone number used at checkout, or{" "}
              <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="underline">WhatsApp us</a>.
            </p>
          )}
          {result.kind === "error" && (
            <p role="alert" className="text-sm font-sans text-red-600">
              We couldn't check right now. Please try again in a moment.
            </p>
          )}

          <button
            type="submit"
            disabled={result.kind === "loading"}
            className="w-full bg-storefront-charcoal text-storefront-cream font-sans text-xs tracking-widest uppercase py-4 hover:bg-storefront-warm transition-colors disabled:opacity-40"
          >
            Check Status
          </button>
        </form>
      )}
    </div>
  );
}
