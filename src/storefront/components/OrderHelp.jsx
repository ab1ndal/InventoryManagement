import React from "react";
import { orderHelpUrl } from "../lib/ordersApi";

export default function OrderHelp({ orderRef }) {
  return (
    <p className="text-sm font-sans text-storefront-charcoal">
      Questions about this order?{" "}
      <a href={orderHelpUrl(orderRef)} target="_blank" rel="noopener noreferrer" className="underline">
        WhatsApp us
      </a>
    </p>
  );
}
