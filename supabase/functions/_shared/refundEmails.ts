/**
 * Refund emails (spec §8): the choice link, and "refund completed" (store
 * credit, voucher codes and/or the original payment method). Plain text, so
 * nothing from the order is ever interpreted as markup.
 */

import type { RefundNotice } from "./refunds.ts";

export type Email = { subject: string; text: string };

const IST = "Asia/Kolkata";

export function rupees(n: number): string {
  const fixed = Number.isInteger(n) ? 0 : 2;
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: fixed, maximumFractionDigits: fixed });
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function day(isoDate: string): string {
  return new Date(isoDate + (isoDate.length === 10 ? "T00:00:00+05:30" : "")).toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function itemLines(n: RefundNotice): string[] {
  return n.items.map((i) => {
    const variant = [i.size, i.color].filter(Boolean).join(", ");
    return `- ${i.name}${variant ? ` (${variant})` : ""} × ${i.units}`;
  });
}

export function similarPiecesUrl(n: RefundNotice, siteUrl: string): string | null {
  const cat = n.items.find((i) => i.categoryId)?.categoryId;
  return cat ? `${siteUrl}/shop?category=${encodeURIComponent(cat)}` : null;
}

function greeting(n: RefundNotice): string {
  const first = n.name.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hello,";
}

/** What has already come back: store credit balance and voucher codes. */
function settledLines(n: RefundNotice): string[] {
  const lines: string[] = [];
  const credit = n.legs
    .filter((l) => l.status === "completed" && l.destination === "store_credit")
    .reduce((s, l) => s + l.amount, 0);
  if (credit > 0) lines.push(`${rupees(round2(credit))} has been added to your store credit.`);
  for (const l of n.legs) {
    if (l.status === "completed" && l.voucher) {
      lines.push(
        `${rupees(l.voucher.value)} voucher code: ${l.voucher.code} (valid until ${day(l.voucher.expiry)}; ` +
          `use it at checkout on our website or in the shop).`,
      );
    }
  }
  return lines;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function refundChoiceEmail(n: RefundNotice, siteUrl: string): Email {
  if (!n.token || !n.tokenExpiresAt) throw new Error(`refund ${n.refundId} has no choice link`);
  const link = `${siteUrl}/refund-choice/${n.token}`;
  const similar = similarPiecesUrl(n, siteUrl);
  const settled = settledLines(n);
  const text = [
    greeting(n),
    "",
    `We're sorry: some pieces from your order ${n.orderRef} are no longer available.`,
    "",
    ...itemLines(n),
    "",
    `Refund: ${rupees(n.amount)}`,
    ...(settled.length ? ["", "Already returned to you:", ...settled] : []),
    "",
    `Please choose how you'd like the remaining ${rupees(n.gatewayPart)}:`,
    "- Instant store credit, or",
    "- Refund to your original payment method (5–7 working days).",
    "",
    `Choose here: ${link}`,
    "",
    `If we don't hear from you by ${when(n.tokenExpiresAt)} (48 hours), we'll refund it to your ` +
    "original payment method automatically.",
    ...(similar ? ["", `Looking for something similar? ${similar}`] : []),
    "",
    "Bindals Creation",
  ].join("\n");
  return { subject: `Your refund for order ${n.orderRef}: please choose`, text };
}

export function refundCompletedEmail(n: RefundNotice, siteUrl: string): Email {
  const original = n.legs
    .filter((l) => l.status === "completed" && l.destination === "original")
    .reduce((s, l) => s + l.amount, 0);
  const similar = similarPiecesUrl(n, siteUrl);
  const text = [
    greeting(n),
    "",
    `Your refund of ${rupees(n.amount)} for order ${n.orderRef} is complete.`,
    "",
    ...itemLines(n),
    "",
    ...settledLines(n),
    ...(original > 0
      ? [
        `${rupees(round2(original))} has been refunded to your original payment method. ` +
        "Your bank may take a few working days to show it.",
      ]
      : []),
    ...(similar ? ["", `Looking for something similar? ${similar}`] : []),
    "",
    "Bindals Creation",
  ].join("\n");
  return { subject: `Refund completed for order ${n.orderRef}`, text };
}
