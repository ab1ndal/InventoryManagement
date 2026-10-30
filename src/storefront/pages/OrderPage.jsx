import React, { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import Seo from "../components/Seo";
import OrderDetails from "../components/OrderDetails";
import OrderTimeline from "../components/OrderTimeline";
import { useCart } from "../context/CartContext";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";
import { WHATSAPP_URL, formatRupees, orderStatus } from "../lib/ordersApi";
import { isConfirmed } from "../lib/orderStatus";
import { takePendingOrder } from "../lib/pendingOrder";

export const POLL_INTERVAL_MS = 3000;
// 2 minutes of polling while Cashfree's webhook / status check lands.
const MAX_POLLS = 40;

const HEADLINES = {
  payment_failed: "Payment didn't go through",
  expired: "This order expired before payment was completed",
  cancelled: "This order was cancelled",
  rto: "Your parcel is returning to us",
  rto_received: "Your parcel came back to us",
};

function Headline({ order, timedOut }) {
  if (order.status === "pending_payment") {
    return timedOut ? (
      <>
        <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">Still confirming your payment</h1>
        <p className="text-sm font-sans text-storefront-muted">
          This is taking longer than usual. Refresh this page in a few minutes, or{" "}
          <a href={WHATSAPP_URL} className="underline" target="_blank" rel="noopener noreferrer">WhatsApp us</a>{" "}
          with your order number. If money left your account and the order isn't confirmed, it is refunded automatically.
        </p>
      </>
    ) : (
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2" aria-live="polite">
        Confirming your payment…
      </h1>
    );
  }
  if (isConfirmed(order.status, order.fulfilment)) {
    return (
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">
        Payment received — order confirmed
      </h1>
    );
  }
  return (
    <>
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">
        {HEADLINES[order.status] ?? "Order status"}
      </h1>
      {(order.status === "payment_failed" || order.status === "expired") && (
        <p className="text-sm font-sans text-storefront-muted">
          No order was placed. If any amount was debited, it is refunded automatically. You can go back to your{" "}
          <Link to="/cart" className="underline">cart</Link> and try again.
        </p>
      )}
    </>
  );
}

export default function OrderPage() {
  const { ref } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("t") || "";
  const { user } = useStorefrontAuth();
  const { clearCart } = useCart();
  const [state, setState] = useState({ kind: "loading", order: null });
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    let active = true;
    let timer = null;
    let polls = 0;
    setTimedOut(false);

    async function load() {
      polls += 1;
      let next = null;
      try {
        next = await orderStatus({ orderRef: ref, accessToken: token || undefined });
      } catch (error) {
        if (!active) return;
        if (error.status === 404) {
          setState({ kind: "not_found", order: null });
          return;
        }
        console.warn("order-status failed", { orderRef: ref, code: error.code, status: error.status, message: error.message });
        // Keep polling through a blip if we already showed the order.
        setState((s) => (s.order ? s : { kind: "error", order: null }));
      }
      if (!active) return;
      if (next) setState({ kind: "ready", order: next });
      const pending = next ? next.status === "pending_payment" : true;
      if (!pending) return;
      if (polls >= MAX_POLLS) setTimedOut(true);
      else timer = setTimeout(load, POLL_INTERVAL_MS);
    }

    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [ref, token]);

  const confirmed = state.order ? isConfirmed(state.order.status, state.order.fulfilment) : false;
  useEffect(() => {
    if (confirmed && takePendingOrder(ref)) clearCart();
  }, [confirmed, ref, clearCart]);

  if (state.kind === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Seo title="Your order" noindex />
        <p className="text-sm font-sans text-storefront-muted">Loading your order…</p>
      </div>
    );
  }

  if (state.kind === "not_found" || state.kind === "error") {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
        <Seo title="Your order" noindex />
        <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-2">
          {state.kind === "not_found" ? "We couldn't find that order" : "We couldn't load your order"}
        </h1>
        <p className="text-sm font-sans text-storefront-muted">
          Check the link in your email, <Link to="/track" className="underline">track it with your order number and phone</Link>, or{" "}
          <a href={WHATSAPP_URL} className="underline" target="_blank" rel="noopener noreferrer">WhatsApp us</a>.
        </p>
      </div>
    );
  }

  const order = state.order;
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 space-y-8">
      <Seo title="Your order" noindex />
      <div>
        <p className="text-xs font-sans tracking-widest uppercase text-storefront-muted mb-2">Order {order.orderRef}</p>
        <Headline order={order} timedOut={timedOut} />
      </div>

      {confirmed && !user && (
        <p className="border border-storefront-gold bg-storefront-cream px-4 py-3 text-sm font-sans text-storefront-charcoal">
          Save your order number <strong>{order.orderRef}</strong>. You'll need it with your phone number to track this order.
        </p>
      )}

      {order.leftoverVoucher && (
        <p className="border border-storefront-border px-4 py-3 text-sm font-sans text-storefront-charcoal">
          ₹{formatRupees(order.leftoverVoucher.value)} left on your voucher is now a new voucher,{" "}
          <strong>{order.leftoverVoucher.code}</strong>. We've emailed it to you.
        </p>
      )}

      <OrderTimeline status={order.status} fulfilment={order.fulfilment} />
      {order.fulfilment !== "pickup" && order.trackingUrl && (
        <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-sans underline">
          Track with the courier
        </a>
      )}

      <OrderDetails order={order} />

      <Link to="/track" className="inline-block text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
        Track an order
      </Link>
    </div>
  );
}
