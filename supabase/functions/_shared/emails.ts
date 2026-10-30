/**
 * Plain-text order emails (plan Task 12, spec §6). Pure: data in, message out.
 * Wording is plain and short, matching the site's tone. No GST lines: the
 * shop is a composition dealer (Bill of Supply).
 */

import { UP_STATE } from "./pincode.ts";

export type EmailItem = { name: string; size: string | null; color: string | null; qty: number; status: string };

export type EmailOrder = {
  orderRef: string;
  fulfilment: "ship" | "pickup";
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  address: Record<string, unknown>;
  items: EmailItem[];
  subtotal: number;
  promoDiscount: number;
  shipping: number;
  voucherApplied: number;
  creditApplied: number;
  gatewayAmount: number;
  awb: string | null;
  courier: "shiprocket" | "porter" | null;
  courierName: string | null;
  /** Link staff pasted for a hand-booked (Porter) delivery; null when none. */
  manualTrackingUrl: string | null;
  leftoverVoucher: { code: string; value: number } | null;
};

export type Email = { subject: string; text: string };

export const SHOP_NAME = "Bindals Creation";
export const SHOP_ADDRESS = "58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001";

const inr = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

export const trackingUrl = (awb: string) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;

function itemLine(i: EmailItem): string {
  const variant = [i.size, i.color].filter((x) => x && String(x).trim()).join(", ");
  const note = i.status === "unavailable" ? " (out of stock: we'll email you about the refund)" : "";
  return `- ${i.name}${variant ? ` (${variant})` : ""} x ${i.qty}${note}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function moneyLines(o: EmailOrder): string[] {
  const lines = [`Items: ${inr(o.subtotal)}`];
  if (o.promoDiscount > 0) lines.push(`Discount: -${inr(o.promoDiscount)}`);
  lines.push(`Shipping: ${o.fulfilment === "pickup" ? "Free (store pickup)" : o.shipping > 0 ? inr(o.shipping) : "Free"}`);
  if (o.voucherApplied > 0) lines.push(`Voucher: -${inr(o.voucherApplied)}`);
  if (o.creditApplied > 0) lines.push(`Store credit: -${inr(o.creditApplied)}`);
  lines.push(`Total paid: ${inr(o.subtotal - o.promoDiscount + o.shipping)}` +
    (o.voucherApplied + o.creditApplied > 0 ? ` (${inr(o.gatewayAmount)} paid online)` : ""));
  return lines;
}

function addressLines(a: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  const landmark = s("landmark");
  return [
    s("line1"),
    s("line2"),
    landmark && `Landmark: ${landmark}`,
    [s("city"), s("state"), s("pincode")].filter(Boolean).join(", "),
  ].filter((x): x is string => !!x);
}

// Out-of-UP orders are accepted but fulfilled case by case (owner 2026-10-30).
function inUp(a: Record<string, unknown>): boolean {
  return typeof a.state === "string" && a.state.trim().toLowerCase() === UP_STATE.toLowerCase();
}

export function orderConfirmed(o: EmailOrder, siteUrl: string): Email {
  const next = o.fulfilment === "pickup"
    ? `You chose store pickup at ${SHOP_ADDRESS}. We'll email you when your order is ready to collect (usually 1–2 days).`
    : `${
      inUp(o.address)
        ? "We deliver within Uttar Pradesh."
        : "We'll confirm delivery to your address on WhatsApp before dispatch."
    } We'll email you again when your parcel ships.`;
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    `Thank you for shopping with ${SHOP_NAME}. Your order ${o.orderRef} is confirmed.`,
    "",
    ...o.items.map(itemLine),
    "",
    ...moneyLines(o),
    ...(o.leftoverVoucher
      ? ["", `Your voucher had ${inr(o.leftoverVoucher.value)} left over. Use this new code next time: ${o.leftoverVoucher.code}`]
      : []),
    "",
    next,
    "",
    `Your order: ${siteUrl}/order/${o.orderRef}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} confirmed`, text };
}

export function shopNewOrder(o: EmailOrder, siteUrl: string): Email {
  const text = [
    `New online order ${o.orderRef}.`,
    "",
    `Customer: ${o.contactName}, ${o.contactPhone}${o.contactEmail ? `, ${o.contactEmail}` : ""}`,
    ...(o.fulfilment === "pickup" ? ["  Store pickup"] : addressLines(o.address).map((l) => `  ${l}`)),
    "",
    ...o.items.map(itemLine),
    "",
    ...moneyLines(o),
    "",
    o.fulfilment === "pickup"
      ? `Check the shelf and mark it ready for pickup: ${siteUrl}/admin/online-orders`
      : `Check the shelf and process it: ${siteUrl}/admin/online-orders`,
  ].join("\n");
  return {
    subject: `New online order ${o.orderRef}${o.fulfilment === "pickup" ? " (store pickup)" : ""}`,
    text,
  };
}

/** A Shiprocket shipment needs its AWB; a Porter delivery has none (link optional). */
export function shipped(o: EmailOrder, siteUrl: string): Email {
  let tracking: string[];
  if (o.courier === "porter") {
    tracking = o.manualTrackingUrl
      ? [`Track it here: ${o.manualTrackingUrl}`]
      : ["We'll share the delivery details with you on WhatsApp."];
  } else {
    if (!o.awb) throw new Error(`order ${o.orderRef} has no AWB yet`);
    tracking = [`Tracking number (AWB): ${o.awb}`, `Track it here: ${trackingUrl(o.awb)}`];
  }
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    `Your order ${o.orderRef} is on its way${o.courierName ? ` with ${o.courierName}` : ""}.`,
    ...tracking,
    "",
    `Your order: ${siteUrl}/order/${o.orderRef}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} has shipped`, text };
}

export function readyForPickup(o: EmailOrder, siteUrl: string): Email {
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    `Your order ${o.orderRef} is ready to collect at our shop:`,
    SHOP_NAME,
    SHOP_ADDRESS,
    "",
    ...o.items.map(itemLine),
    "",
    `Please bring your order number (${o.orderRef}). It's already paid.`,
    "If you have a question, reply to this email or WhatsApp us.",
    "",
    `Your order: ${siteUrl}/order/${o.orderRef}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} is ready for pickup`, text };
}

export function delivered(o: EmailOrder, siteUrl: string): Email {
  const pickup = o.fulfilment === "pickup";
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    pickup
      ? `You've collected your order ${o.orderRef}. We hope you love it.`
      : `Your order ${o.orderRef} has been delivered. We hope you love it.`,
    "If anything isn't right, reply to this email or WhatsApp us.",
    "",
    `Shop again: ${siteUrl}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} ${pickup ? "collected" : "delivered"}`, text };
}
