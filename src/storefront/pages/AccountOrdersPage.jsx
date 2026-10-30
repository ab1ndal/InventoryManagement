import React, { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import Seo from "../components/Seo";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";
import { formatRupees, myOrders } from "../lib/ordersApi";
import { statusLabel } from "../lib/orderStatus";

const BADGE_TONES = {
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  rto: "bg-red-100 text-red-800",
  rto_received: "bg-red-100 text-red-800",
};

function orderTotal(t) {
  return t.subtotal - t.promoDiscount + t.shipping;
}

export default function AccountOrdersPage() {
  const { user, loading } = useStorefrontAuth();
  // loading | ready | error
  const [state, setState] = useState({ kind: "loading", orders: [] });

  useEffect(() => {
    if (!user) return;
    let active = true;
    myOrders()
      .then((orders) => {
        if (active) setState({ kind: "ready", orders });
      })
      .catch((error) => {
        console.warn("my_online_orders failed", error);
        if (active) setState({ kind: "error", orders: [] });
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (!loading && !user) return <Navigate to="/login" replace />;

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
      <Seo title="Order history" noindex />
      <h1 className="font-display text-3xl font-semibold text-storefront-charcoal mb-8">Order history</h1>

      {state.kind === "loading" && <p className="text-sm font-sans text-storefront-muted">Loading your orders…</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm font-sans text-red-600">We couldn't load your orders. Please try again later.</p>
      )}
      {state.kind === "ready" && state.orders.length === 0 && (
        <p className="text-sm font-sans text-storefront-muted">
          You haven't placed any online orders yet. For past in-store purchases, contact us and we'll help.
        </p>
      )}
      {state.kind === "ready" && state.orders.length > 0 && (
        <ul className="divide-y divide-storefront-border border-y border-storefront-border">
          {state.orders.map((o) => (
            <li key={o.orderRef} data-testid="account-order" className="py-4 flex items-center justify-between gap-4 font-sans text-sm text-storefront-charcoal">
              <div>
                <p className="font-semibold">{o.orderRef}</p>
                <p className="text-xs text-storefront-muted">
                  {o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : ""}
                  {" · "}₹{formatRupees(orderTotal(o.totals))}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className={`px-2 py-1 text-xs rounded ${BADGE_TONES[o.status] ?? "bg-storefront-cream text-storefront-charcoal"}`}>
                  {statusLabel(o.status, o.fulfilment)}
                </span>
                <Link to={`/order/${o.orderRef}`} className="text-xs tracking-widest uppercase text-storefront-gold hover:underline">
                  Track
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Link to="/account" className="inline-block mt-8 text-xs font-sans tracking-widest uppercase text-storefront-gold hover:underline">
        ← Back to account
      </Link>
    </div>
  );
}
