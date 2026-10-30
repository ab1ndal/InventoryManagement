import React from "react";
import { formatSize } from "../lib/sizes";
import { formatRupees } from "../lib/ordersApi";

function Row({ label, value, strong }) {
  return (
    <div className={`flex justify-between${strong ? " font-semibold pt-2 border-t border-storefront-border" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

// Line states from `_item_status` in schema/migration_online_orders.sql.
const ITEM_NOTES = {
  unavailable: "Not available — refund on its way",
  partially_available: "Some pieces not available — refund on its way",
  refunded: "Refunded",
};

// Items and money of a placed order (order-status / lookup shape).
export default function OrderDetails({ order }) {
  const t = order.totals;
  const freeShipping = order.fulfilment === "pickup" ? "Free (store pickup)" : "Free";
  return (
    <div className="font-sans text-sm text-storefront-charcoal">
      <ul className="divide-y divide-storefront-border border-t border-storefront-border">
        {order.items.map((i, index) => (
          <li key={`${i.name}-${index}`} className="flex justify-between py-3">
            <span>
              {i.name} ({formatSize(i.size)}/{i.color}) ×{i.qty}
              {ITEM_NOTES[i.status] && <span className="block text-xs text-storefront-muted">{ITEM_NOTES[i.status]}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-storefront-border pt-4 mt-2 space-y-2">
        <Row label="Subtotal" value={`₹${formatRupees(t.subtotal)}`} />
        {t.promoDiscount > 0 && <Row label="Promo discount" value={`−₹${formatRupees(t.promoDiscount)}`} />}
        <Row label="Shipping" value={t.shipping > 0 ? `₹${formatRupees(t.shipping)}` : freeShipping} />
        {t.voucherApplied > 0 && <Row label="Voucher" value={`−₹${formatRupees(t.voucherApplied)}`} />}
        {t.creditApplied > 0 && <Row label="Store credit" value={`−₹${formatRupees(t.creditApplied)}`} />}
        <Row label="Paid online" value={`₹${formatRupees(t.gatewayAmount)}`} strong />
      </div>
    </div>
  );
}
