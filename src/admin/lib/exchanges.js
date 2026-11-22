// src/admin/lib/exchanges.js
// The exchange part of a CLI bill spec: goods returned from an earlier paid bill, whose credit pays
// for the new bill. Recorded as the app records it, in the same two steps (tasks/cli-exchange-plan.md):
// the Exchange page's exchange_record (restock + unspent credit rows), then the bill screen's
// bill_save with the exchange ids. The database refuses credit cashed twice in both RPCs
// (schema/migration_exchange_record_caps.sql, schema/migration_bill_save_drafts.sql); planExchange
// runs the same checks read-only first, so a refusal shows in the preview before anything is written.
// Functions take the Supabase client; imports carry .js for Node ESM.
import {
  calcItemCredit,
  isExchangeEligible,
  returnableLeft,
  isAllowedReturnQty,
  EXCHANGE_WINDOW_DAYS,
} from "../components/billing/exchangeHelpers.js";
import { round2 } from "../components/billing/billUtils.js";
import { money, variantLabel } from "../../utility/activitySummary.js";
import { todayIST } from "../../utility/dateFormat.js";
import { normalizeProductCode } from "./products.js";
import { logActivityWith } from "./activity.js";

export class ExchangeInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExchangeInputError";
  }
}

const fail = (msg) => {
  throw new ExchangeInputError(msg);
};
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
function checkKeys(obj, allowed, at) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) fail(`${at}: unknown field(s) ${extra.join(", ")} (allowed: ${allowed.join(", ")})`);
}

// What to do with credit left over once the new bill is paid: the bill screen's two choices.
export const EXCHANGE_BALANCE = ["store_credit", "cash_refund"];
// What exchange_record allows over what a bill holds (its c_paid_in_full_tolerance).
const HELD_TOLERANCE = 1;

// ExchangePage's EXCHANGE_ERRORS: exchange_record refusals in words staff can act on.
const RECORD_ERRORS = {
  EXCHANGE_BILL_NOT_FINAL: "Only a fully paid bill can be exchanged. This bill is not paid in full, or was changed or cancelled.",
  EXCHANGE_OVER_LINE: "The credit is more than this item was sold for.",
  EXCHANGE_OVER_HELD: "This bill has already given back what the customer paid for it, as an earlier exchange, refund or store credit. No more credit can come from it.",
  EXCHANGE_BAD_DATE: "The return date is before the sale or after today.",
  EXCHANGE_WHOLE_LINE: "Fabric goes back whole: return the full length left on the line, or nothing.",
};
// PostgREST's "no function with these arguments": the database predates p_returndate.
const FUNCTION_NOT_FOUND = "PGRST202";
const RETURN_DATE_MIGRATION = "schema/migration_exchange_record_return_date.sql";

const ITEM_FIELDS = ["product", "size", "color", "bill_item_id", "qty", "reason"];

/** Validates the spec's exchange block (shape only). */
export function parseExchange(ex) {
  if (!isObj(ex)) fail('exchange must be an object: { bill, items } or { exchange_ids }');
  checkKeys(ex, ["bill", "items", "exchange_ids", "balance"], "exchange");
  const balance = ex.balance ?? null;
  if (balance != null && !EXCHANGE_BALANCE.includes(balance)) {
    fail(`exchange.balance must be ${EXCHANGE_BALANCE.join(" or ")}, got ${JSON.stringify(ex.balance)}`);
  }
  if ((ex.exchange_ids != null) === (ex.bill != null || ex.items != null)) {
    fail("exchange: give bill and items (goods returned now), or exchange_ids (credit recorded earlier), not both");
  }
  if (ex.exchange_ids != null) {
    const ids = ex.exchange_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => Number.isInteger(id) && id > 0)) {
      fail("exchange.exchange_ids must be a list of exchange ids, e.g. [77]");
    }
    if (new Set(ids).size !== ids.length) fail("exchange.exchange_ids: an id is listed twice");
    return { kind: "recorded", exchange_ids: ids, balance };
  }
  if (typeof ex.bill !== "string" || ex.bill.trim() === "") fail('exchange.bill is required: the bill the goods were bought on, e.g. "FY26-000123"');
  if (!Array.isArray(ex.items) || ex.items.length === 0) fail("exchange.items: at least one returned item is required");
  const items = ex.items.map((it, i) => {
    const at = `exchange.items[${i}]`;
    if (!isObj(it)) fail(`${at} must be an object`);
    checkKeys(it, ITEM_FIELDS, at);
    if ((it.product != null) === (it.bill_item_id != null)) fail(`${at}: give exactly one of product or bill_item_id`);
    if ((it.color != null || it.size != null) && it.product == null) fail(`${at}: color/size only go with product`);
    if (it.bill_item_id != null && !Number.isInteger(it.bill_item_id)) fail(`${at}.bill_item_id must be a whole number`);
    // A fraction is only taken as a fabric line's whole length (checked against the line in planReturn).
    if (typeof it.qty !== "number" || !Number.isFinite(it.qty) || it.qty <= 0) fail(`${at}.qty must be a number > 0, got ${JSON.stringify(it.qty)}`);
    return {
      ref: it.product != null
        ? {
            kind: "product",
            code: normalizeProductCode(it.product),
            size: it.size != null ? String(it.size).trim() : null,
            color: it.color != null ? String(it.color).trim() : null,
          }
        : { kind: "line", bill_item_id: it.bill_item_id },
      qty: it.qty,
      reason: it.reason != null && String(it.reason).trim() !== "" ? String(it.reason).trim() : null,
    };
  });
  return { kind: "return", bill: ex.bill.trim().toUpperCase(), items, balance };
}

async function one(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// Quantities are numeric(10,3): fabric by the metre.
const round3 = (n) => Math.round(n * 1000) / 1000;
const eqi = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const lineLabel = (l) => `${l.product_code || l.product_name}${l.size || l.color ? ` ${variantLabel(l.size, l.color)}` : ""} (bill_item_id ${l.bill_item_id})`;
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// How an earlier exchange of a line stands: spent on a bill, or still unspent credit.
const earlierExchange = (x) =>
  `exchange ${x.exchangeid}: ${x.quantity} returned, credit ${money(x.credit_amount)}, ` +
  (x.new_billid != null ? `spent on bill ${x.new_bill?.bill_number ?? x.new_billid}` : "not spent yet");

/**
 * Reads what the exchange returns and the credit it gives, as the Exchange page works it out,
 * and refuses what exchange_record or bill_save would refuse. Read-only.
 * customerid: the new bill's customer; date: the new bill's date (YYYY-MM-DD).
 */
export async function planExchange(client, ex, { customerid, date }) {
  return ex.kind === "recorded"
    ? planRecorded(client, ex, { customerid })
    : planReturn(client, ex, { customerid, date });
}

async function planReturn(client, ex, { customerid, date }) {
  const warnings = [];
  const bill = await one(
    client
      .from("bills")
      .select("billid, bill_number, customerid, orderdate, paymentstatus, payment_amount, store_credit_used, stock_reduced")
      .eq("bill_number", ex.bill)
      .maybeSingle(),
  );
  if (!bill) fail(`exchange.bill: no bill numbered ${ex.bill}`);
  // The Exchange page lists only paid bills, and exchange_record refuses any other.
  if (bill.paymentstatus !== "finalized") {
    fail(`exchange.bill ${ex.bill} is ${bill.paymentstatus}: ${RECORD_ERRORS.EXCHANGE_BILL_NOT_FINAL}`);
  }
  // bill_save refuses credit of another customer (BILL_EXCHANGE_CUSTOMER).
  if (bill.customerid != null && bill.customerid !== customerid) {
    fail(`exchange.bill ${ex.bill} belongs to customer ${bill.customerid}; the credit can only pay for that customer's bill (this bill is for ${customerid ?? "no customer"})`);
  }

  const [lines, order, payments] = await Promise.all([
    one(
      client
        .from("bill_items")
        .select("bill_item_id, product_name, product_code, quantity, total, alteration_charge, variantid")
        .eq("billid", bill.billid)
        .order("bill_item_id"),
    ),
    one(client.from("orders").select("delivered_at").eq("bill_id", bill.billid).maybeSingle()),
    one(client.from("bill_payments").select("amount").eq("billid", bill.billid)),
  ]);
  const rows = lines ?? [];
  const variantIds = rows.filter((l) => l.variantid).map((l) => l.variantid);
  const manualCodes = rows.filter((l) => !l.variantid && l.product_code).map((l) => l.product_code);
  const lineIds = rows.map((l) => l.bill_item_id);
  const [variants, manuals, earlier] = await Promise.all([
    variantIds.length
      ? one(client.from("productsizecolors").select("variantid, size, color, stock").in("variantid", variantIds))
      : [],
    manualCodes.length
      ? one(client.from("manual_items").select("manual_item_id, size, color, stock").in("manual_item_id", manualCodes))
      : [],
    lineIds.length
      ? one(
          client
            .from("exchanges")
            .select("exchangeid, original_bill_item_id, quantity, credit_amount, new_billid, new_bill:bills!exchanges_new_billid_fkey(bill_number)")
            .in("original_bill_item_id", lineIds),
        )
      : [],
  ]);
  const variantById = Object.fromEntries((variants ?? []).map((v) => [v.variantid, v]));
  const manualById = Object.fromEntries((manuals ?? []).map((m) => [m.manual_item_id, m]));
  const billLines = rows.map((l) => {
    const sc = l.variantid ? variantById[l.variantid] : manualById[l.product_code];
    const ex = (earlier ?? []).filter((x) => x.original_bill_item_id === l.bill_item_id);
    return {
      ...l,
      size: sc?.size ?? null,
      color: sc?.color ?? null,
      // A manual item's stock (BCX…); null for a line with no variant that is not one.
      stock: l.variantid
        ? Number(variantById[l.variantid]?.stock ?? 0)
        : manualById[l.product_code] ? Number(manualById[l.product_code].stock) : null,
      earlier: ex,
      returnedQty: round3(ex.reduce((n, x) => n + Number(x.quantity || 0), 0)),
      creditGiven: round2(ex.reduce((n, x) => n + Number(x.credit_amount || 0), 0)),
    };
  });
  const listLines = () => billLines.map(lineLabel).join("; ") || "none";

  // Online bills: exchange_record refuses one not delivered yet, and the window runs from delivery.
  if (order && !order.delivered_at) fail(`exchange.bill ${ex.bill} is an online order that has not been delivered yet`);
  const windowFrom = order?.delivered_at ? todayIST(new Date(order.delivered_at)) : String(bill.orderdate).slice(0, 10);
  const days = daysBetween(windowFrom, date);
  if (days < 0) fail(`exchange.bill ${ex.bill} is dated ${windowFrom}, after this bill's date ${date}`);
  const ageText = `Bill #${bill.bill_number} ${order?.delivered_at ? `was delivered ${days} days` : `is ${days} days old`} on ${date}`;
  const outsideWindow = days > EXCHANGE_WINDOW_DAYS;
  if (outsideWindow) {
    warnings.push(`${ageText}, outside the ${EXCHANGE_WINDOW_DAYS}-day exchange window (the Exchange page asks to allow it; create logs that it was allowed)`);
  }
  if (bill.stock_reduced === false) {
    warnings.push(`${ex.bill} was saved with "don't reduce stock", but the return still puts the pieces back in stock (as the Exchange page does)`);
  }

  const seen = new Set();
  const returned = ex.items.map((it, i) => {
    const at = `exchange.items[${i}]`;
    const { ref } = it;
    const matches = ref.kind === "line"
      ? billLines.filter((l) => l.bill_item_id === ref.bill_item_id)
      : billLines.filter(
          (l) =>
            normalizeProductCode(l.product_code) === ref.code &&
            (ref.size == null || eqi(l.size, ref.size)) &&
            (ref.color == null || eqi(l.color, ref.color)),
        );
    if (matches.length === 0) fail(`${at}: not on bill ${ex.bill} (its lines: ${listLines()})`);
    if (matches.length > 1) fail(`${at}: matches ${matches.length} lines of ${ex.bill}, give size/color or bill_item_id: ${matches.map(lineLabel).join("; ")}`);
    const line = matches[0];
    if (seen.has(line.bill_item_id)) fail(`${at}: ${lineLabel(line)} is listed twice; give one entry with the total qty`);
    seen.add(line.bill_item_id);
    if (!isExchangeEligible(line)) fail(`${at}: ${lineLabel(line)} had an alteration charge, so it cannot be exchanged (the service was rendered)`);
    const left = returnableLeft(line);
    if (it.qty > left) {
      const unspent = line.earlier.filter((x) => x.new_billid == null).map((x) => x.exchangeid);
      fail(
        `${at}: ${lineLabel(line)} was bought ${Number(line.quantity)}, ${line.returnedQty} already returned, so at most ${left} can be returned now` +
          (line.earlier.length ? ` (${line.earlier.map(earlierExchange).join("; ")})` : "") +
          (unspent.length ? `. If this slip spends that credit, use "exchange": {"exchange_ids": ${JSON.stringify(unspent)}}` : ""),
      );
    }
    // exchange_record refuses part of a length (EXCHANGE_WHOLE_LINE).
    if (!isAllowedReturnQty(it.qty, left)) {
      fail(
        Number.isInteger(left)
          ? `${at}: ${lineLabel(line)}: qty must be a whole number, got ${it.qty}`
          : `${at}: ${lineLabel(line)}: ${RECORD_ERRORS.EXCHANGE_WHOLE_LINE} Give qty ${left} (all that is left)`,
      );
    }
    const credit = calcItemCredit(line, it.qty);
    return {
      bill_item_id: line.bill_item_id,
      code: line.product_code,
      name: line.product_name,
      size: line.size,
      color: line.color,
      qty: it.qty,
      credit,
      reason: it.reason,
      // exchange_record puts the pieces back: on the variant, or on the manual item the line names.
      stock: line.variantid
        ? { variantid: line.variantid, stock_before: line.stock, stock_after: round3(line.stock + it.qty) }
        : line.stock != null
          ? { manual_item_id: line.product_code, stock_before: line.stock, stock_after: round3(line.stock + it.qty) }
          : null,
      line,
    };
  });
  const credit = round2(returned.reduce((s, r) => s + r.credit, 0));

  // What the shop holds for the bill, read as exchange_record reads it; every exchange of its
  // lines, this one included, must fit in it (EXCHANGE_OVER_HELD).
  const held = order
    ? Number(bill.payment_amount ?? 0) + Number(bill.store_credit_used ?? 0)
    : (payments ?? []).length
      ? (payments ?? []).reduce((s, p) => s + Number(p.amount || 0), 0)
      : Number(bill.payment_amount ?? 0);
  const given = round2(billLines.reduce((s, l) => s + l.creditGiven, 0));
  if (round2(given + credit) - round2(held) >= HELD_TOLERANCE) {
    fail(`exchange.bill ${ex.bill}: ${RECORD_ERRORS.EXCHANGE_OVER_HELD} (holds ${money(round2(held))}, credit already given ${money(given)}, this exchange ${money(credit)})`);
  }

  return {
    kind: "return",
    source_bill: bill.bill_number,
    returned: returned.map(({ line, reason, ...r }) => r),
    exchange_ids: null,
    credit,
    // exchange_record's arguments, as ExchangePage.handleConfirm sends them, plus the slip date
    // as the return date, at midday (as a backdated payment is) so no time zone moves the day.
    record: {
      p_billid: bill.billid,
      p_customerid: bill.customerid ?? null,
      p_returndate: `${date}T12:00:00`,
      p_items: returned.map((r) => ({
        bill_item_id: r.bill_item_id,
        quantity: r.qty,
        credit_amount: r.credit,
        reason: r.reason,
        product_name: r.line.product_name || null,
        product_code: r.line.product_code || null,
        // No manual_item_id, as from ExchangePage: exchange_record restocks a manual item from
        // the line's own product_code.
        variantid: r.line.variantid || null,
      })),
    },
    outside_window: outsideWindow ? ageText : null,
    warnings,
  };
}

// Credit recorded earlier (the Exchange page, or a bill create that failed after recording) and
// not spent yet: the bill screen's "Apply exchange credit". Nothing is returned again.
async function planRecorded(client, ex, { customerid }) {
  const rows = await one(
    client
      .from("exchanges")
      .select("exchangeid, customerid, quantity, credit_amount, new_billid, product_name, product_code, new_bill:bills!exchanges_new_billid_fkey(bill_number), bill_items(product_name, product_code, bills(bill_number))")
      .in("exchangeid", ex.exchange_ids),
  );
  const byId = Object.fromEntries((rows ?? []).map((r) => [r.exchangeid, r]));
  const missing = ex.exchange_ids.filter((id) => !byId[id]);
  if (missing.length) fail(`exchange.exchange_ids: no exchange ${missing.join(", ")}`);
  const list = ex.exchange_ids.map((id) => byId[id]);
  for (const x of list) {
    // bill_save refuses these (BILL_EXCHANGE_USED, BILL_EXCHANGE_CUSTOMER).
    if (x.new_billid != null) fail(`exchange.exchange_ids: exchange ${x.exchangeid} was already spent on bill ${x.new_bill?.bill_number ?? x.new_billid}`);
    if (x.customerid != null && x.customerid !== customerid) {
      fail(`exchange.exchange_ids: exchange ${x.exchangeid} is customer ${x.customerid}'s credit; it can only pay for that customer's bill`);
    }
  }
  const bills = [...new Set(list.map((x) => x.bill_items?.bills?.bill_number).filter(Boolean))];
  return {
    kind: "recorded",
    source_bill: bills.length === 1 ? bills[0] : null,
    returned: list.map((x) => ({
      exchangeid: x.exchangeid,
      code: x.bill_items?.product_code ?? x.product_code ?? null,
      name: x.bill_items?.product_name ?? x.product_name ?? null,
      bill: x.bill_items?.bills?.bill_number ?? null,
      qty: Number(x.quantity),
      credit: Number(x.credit_amount),
    })),
    exchange_ids: ex.exchange_ids,
    credit: round2(list.reduce((s, x) => s + Number(x.credit_amount || 0), 0)),
    record: null,
    outside_window: null,
    warnings: [],
  };
}

/**
 * Records the planned return as the Exchange page's Confirm does: exchange_record restocks the
 * pieces and writes the unspent credit rows in one transaction, then the page's activity entry.
 * Returns the new exchange ids, in input order.
 */
export async function recordExchange(client, plan, { source = "via CLI" } = {}) {
  if (plan.outside_window) {
    await logActivityWith(client, {
      action: "update",
      entityType: "bill",
      entityId: plan.source_bill,
      summary: `Allowed exchange outside the ${EXCHANGE_WINDOW_DAYS}-day window: ${plan.outside_window} (${source})`,
    });
  }
  const { data: ids, error } = await client.rpc("exchange_record", plan.record);
  if (error?.code === FUNCTION_NOT_FOUND) {
    throw new Error(
      `Exchange not recorded, nothing was saved: the database's exchange_record does not take a return date yet; ` +
        `the owner must run ${RETURN_DATE_MIGRATION} first (${error.message})`,
    );
  }
  if (error) {
    throw new Error(
      `Exchange not recorded, nothing was saved: ${RECORD_ERRORS[error.message] ?? error.message}` +
        (error.details ? ` (${error.details})` : ""),
    );
  }
  const n = plan.returned.length;
  await logActivityWith(client, {
    action: "create",
    entityType: "bill",
    entityId: plan.source_bill,
    summary: `Exchange recorded on bill #${plan.source_bill} — ${n} ${n === 1 ? "item" : "items"}, ₹${plan.credit.toFixed(2)} credit (${source})`,
  });
  return ids;
}
