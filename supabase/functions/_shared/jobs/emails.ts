// Email job handlers (Pay slice): email_confirmed, email_shop, email_shipped,
// email_delivered. Enqueued by the DB (confirm, apply_tracking) and run by run-jobs.
//
// Missing shopper email skips the customer email and finishes the job (R17);
// a mailer without credentials resolves {sent:false} and also finishes, so
// jobs don't retry forever before Gmail is set up. A real send failure throws
// and run-jobs retries with backoff. A retry after a send that succeeded but
// whose finish was lost can repeat one email; that is accepted (at-least-once).
import type { JobContext, OrderJob } from "./types.ts";
import { createStore, logEvent, type Store } from "../context.ts";
import { delivered, type Email, type EmailOrder, orderConfirmed, shipped, shopNewOrder } from "../emails.ts";

export async function loadEmailOrder(store: Store, orderId: string): Promise<EmailOrder> {
  const o = await store.orderById(orderId);
  if (!o) throw new Error(`order ${orderId} not found`);
  const items = await store.orderItems(o.id);
  const leftoverValue = o.leftover_voucher_id ? await store.voucherValue(o.leftover_voucher_id) : null;
  return {
    orderRef: o.order_ref,
    contactName: o.contact_name,
    contactPhone: o.contact_phone,
    contactEmail: o.contact_email?.trim() || null,
    address: o.address ?? {},
    items: items.map((i) => ({ name: i.product_name, size: i.size, color: i.color, qty: i.qty, status: i.status })),
    subtotal: o.subtotal,
    promoDiscount: o.promo_discount,
    shipping: o.shipping,
    voucherApplied: o.voucher_applied,
    creditApplied: o.credit_applied,
    gatewayAmount: o.gateway_amount,
    awb: o.awb,
    courierName: o.courier_name,
    leftoverVoucher: o.leftover_voucher_id && leftoverValue !== null
      ? { code: o.leftover_voucher_id, value: leftoverValue }
      : null,
  };
}

export async function sendOrderEmail(ctx: JobContext, store: Store, job: OrderJob): Promise<void> {
  const order = await loadEmailOrder(store, job.order_id);
  const site = ctx.env.siteUrl;
  let to: string | null;
  let mail: Email;
  switch (job.kind) {
    case "email_confirmed":
      to = order.contactEmail;
      mail = orderConfirmed(order, site);
      break;
    case "email_shop":
      to = ctx.env.shopEmail || null;
      mail = shopNewOrder(order, site);
      break;
    case "email_shipped":
      if (!order.awb) throw new Error(`order ${order.orderRef} has no AWB yet`);
      to = order.contactEmail;
      mail = shipped({ ...order, awb: order.awb }, site);
      break;
    case "email_delivered":
      to = order.contactEmail;
      mail = delivered(order, site);
      break;
    default:
      throw new Error(`emails: unknown job kind ${job.kind}`);
  }
  if (!to) {
    logEvent("info", "email_skipped_no_recipient", { kind: job.kind, orderRef: order.orderRef });
    return;
  }
  const res = await ctx.mailer.send({ to, subject: mail.subject, text: mail.text });
  const sent = (res as { sent?: unknown } | null)?.sent !== false;
  logEvent("info", sent ? "email_sent" : "email_not_sent", { kind: job.kind, orderRef: order.orderRef });
}

export function handle(ctx: JobContext, job: OrderJob): Promise<void> {
  return sendOrderEmail(ctx, createStore(ctx.db), job);
}
