import React from "react";
import { useCart } from "../../context/CartContext";
import { holdNote } from "../../lib/cartLogic";

// Why a cart line isn't (fully) reserved for the shopper, if it isn't.
export default function HoldNote({ item, className = "" }) {
  const { holdStatus } = useCart();
  const note = holdNote(holdStatus[item.variant_id], item.quantity);
  if (!note) return null;
  return <p className={`font-sans text-amber-700 ${className}`}>{note}</p>;
}
