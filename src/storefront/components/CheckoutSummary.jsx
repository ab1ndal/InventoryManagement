import React from "react";
import { formatSize } from "../lib/sizes";
import { formatRupees } from "../lib/ordersApi";

function Row({ label, value, testId, strong }) {
  return (
    <div className={`flex justify-between${strong ? " font-semibold pt-2 border-t border-storefront-border" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

const CALCULATING = "Calculating…";
const NEED_PINCODE = "Enter your pincode";

// Never show a stand-in shipping figure that changes a moment later (owner
// 2026-10-30): while a re-quote is in flight both lines say Calculating…, and
// without a pincode the shipping is unknown, so To pay is too.
function shippingText(q, shippingSource, hasPincode, calculating) {
  if (calculating) return CALCULATING;
  if (shippingSource === "free" || q.shipping === 0) return "Free";
  if (!hasPincode) return NEED_PINCODE;
  return `₹${formatRupees(q.shipping)}`;
}

function toPayText(q, hasPincode, calculating) {
  if (calculating) return CALCULATING;
  if (!hasPincode && q.shipping > 0) return NEED_PINCODE;
  return `₹${formatRupees(q.gatewayAmount)}`;
}

// Server-priced order summary for the live checkout (checkout-quote response).
export default function CheckoutSummary({ response, hasPincode, calculating = false }) {
  const q = response.quote;
  return (
    <>
      <ul className="divide-y divide-storefront-border border-t border-storefront-border">
        {q.lines.map((l) => (
          <li key={l.variantId} className="flex justify-between py-3 text-sm font-sans text-storefront-charcoal">
            <span>{l.name} ({formatSize(l.size)}/{l.color}) ×{l.qty}</span>
            <span className="tabular-nums">₹{formatRupees(l.unitPrice * l.qty)}</span>
          </li>
        ))}
      </ul>
      <div className="border-t border-storefront-border pt-4 mt-2 space-y-2 text-sm font-sans text-storefront-charcoal">
        <Row label="Subtotal" value={`₹${formatRupees(q.subtotal)}`} testId="quote-subtotal" />
        {q.promoDiscount > 0 && (
          <Row label="Promo discount" value={`−₹${formatRupees(q.promoDiscount)}`} testId="quote-promo" />
        )}
        <div className="flex justify-between">
          <span>
            Shipping
            {response.shippingSource === "flat" && hasPincode && q.shipping > 0 && !calculating && (
              <span className="block text-xs text-storefront-muted">Standard rate</span>
            )}
          </span>
          <span className="tabular-nums" data-testid="quote-shipping">
            {shippingText(q, response.shippingSource, hasPincode, calculating)}
          </span>
        </div>
        {q.voucherApplied > 0 && (
          <Row label="Voucher" value={`−₹${formatRupees(q.voucherApplied)}`} testId="quote-voucher" />
        )}
        {q.creditApplied > 0 && (
          <Row label="Store credit" value={`−₹${formatRupees(q.creditApplied)}`} testId="quote-credit" />
        )}
        <Row label="To pay" value={toPayText(q, hasPincode, calculating)} testId="quote-to-pay" strong />
      </div>
    </>
  );
}
