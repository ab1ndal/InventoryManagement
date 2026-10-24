/**
 * Plain-text order emails (plan Task 12, spec §6). Pure: data in, message out.
 * Wording is plain and short, matching the site's tone. No GST lines: the
 * shop is a composition dealer (Bill of Supply).
 */

export type EmailItem = { name: string; size: string | null; color: string | null; qty: number; status: string };

export type EmailOrder = {
  orderRef: string;
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
  courierName: string | null;
  leftoverVoucher: { code: string; value: number } | null;
};

export type Email = { subject: string; text: string };

export const SHOP_NAME = "Bindals Creation";

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
  lines.push(`Shipping: ${o.shipping > 0 ? inr(o.shipping) : "Free"}`);
  if (o.voucherApplied > 0) lines.push(`Voucher: -${inr(o.voucherApplied)}`);
  if (o.creditApplied > 0) lines.push(`Store credit: -${inr(o.creditApplied)}`);
  lines.push(`Total paid: ${inr(o.subtotal - o.promoDiscount + o.shipping)}` +
    (o.voucherApplied + o.creditApplied > 0 ? ` (${inr(o.gatewayAmount)} paid online)` : ""));
  return lines;
}

function addressLines(a: Record<string, unknown>): string[] {
  const s = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : null);
  return [s("line1"), s("line2"), [s("city"), s("state"), s("pincode")].filter(Boolean).join(", ")].filter(
    (x): x is string => !!x,
  );
}

export function orderConfirmed(o: EmailOrder, siteUrl: string): Email {
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
    "We deliver within Uttar Pradesh. We'll email you again when your parcel ships.",
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
    ...addressLines(o.address).map((l) => `  ${l}`),
    "",
    ...o.items.map(itemLine),
    "",
    ...moneyLines(o),
    "",
    `Check the shelf and process it: ${siteUrl}/admin/online-orders`,
  ].join("\n");
  return { subject: `New online order ${o.orderRef}`, text };
}

export function shipped(o: EmailOrder & { awb: string }, siteUrl: string): Email {
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    `Your order ${o.orderRef} is on its way${o.courierName ? ` with ${o.courierName}` : ""}.`,
    `Tracking number (AWB): ${o.awb}`,
    `Track it here: ${trackingUrl(o.awb)}`,
    "",
    `Your order: ${siteUrl}/order/${o.orderRef}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} has shipped`, text };
}

export function delivered(o: EmailOrder, siteUrl: string): Email {
  const text = [
    `Hi ${firstName(o.contactName)},`,
    "",
    `Your order ${o.orderRef} has been delivered. We hope you love it.`,
    "If anything isn't right, reply to this email or WhatsApp us.",
    "",
    `Shop again: ${siteUrl}`,
    "",
    `- ${SHOP_NAME}`,
  ].join("\n");
  return { subject: `Order ${o.orderRef} delivered`, text };
}
