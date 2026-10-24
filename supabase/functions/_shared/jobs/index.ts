// Dispatch table for order_jobs kinds. Each handler module is owned by one slice:
//   emails.ts            -> email_confirmed, email_shop, email_shipped, email_delivered (Pay slice)
//   shiprocket_create.ts -> shiprocket_create (Ship slice)
//   refund_notify.ts     -> refund_notify:<refund id> (Refunds slice)
import type { JobHandler } from "./types.ts";
import * as emails from "./emails.ts";
import * as shiprocketCreate from "./shiprocket_create.ts";
import * as refundNotify from "./refund_notify.ts";

export function handlerFor(kind: string): JobHandler | null {
  const base = kind.split(":")[0];
  switch (base) {
    case "email_confirmed":
    case "email_shop":
    case "email_shipped":
    case "email_delivered":
      return emails.handle;
    case "shiprocket_create":
      return shiprocketCreate.handle;
    case "refund_notify":
      return refundNotify.handle;
    default:
      return null;
  }
}
