// src/admin/lib/bills.js
// Bill creation and read-back shared by the admin CLI and, later, the admin
// screens. createBill reproduces BillingForm's direct "Finalize" of a new bill
// (handleConfirmFinalize) for the common case: one customer, inventory and/or
// manual items, per-line discount and alteration, fully paid by one method.
// Out of scope: drafts, discount codes, vouchers, store credit, exchanges,
// partial payment, salespersons, PDF/SMS.
// Functions take the Supabase client; imports carry .js for Node ESM.
import {
  computeBillTotals,
  computeBalanceAdjustedTotals,
  round2,
} from "../components/billing/billUtils.js";
import { buildBillItemsPayload } from "../components/billing/stockHelpers.js";
import { customerName, money } from "../../utility/activitySummary.js";
import { findCustomerByPhone } from "./customers.js";
import { normalizeProductCode } from "./products.js";

export class BillInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "BillInputError";
  }
}

// Same limits as the billing screen: line discount is clamped to 50%
// (ItemRow / pickers), and over 30% needs an explicit acknowledgement.
const MAX_LINE_DISCOUNT_PCT = 50;
const ACK_LINE_DISCOUNT_PCT = 30;
// Paid amount may differ from the bill total by at most this much
// (BillingForm.openFinalizeConfirm); a larger shortfall is a partial payment.
const PAYMENT_TOLERANCE = 100;
const DOC_TYPE = "bos";
const DEFAULT_LOCATION = "Walk-In";

const fail = (msg) => {
  throw new BillInputError(msg);
};
const num = (v, what) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n)) fail(`${what}: "${v ?? ""}" is not a number`);
  return n;
};

/** Validates the bill spec's shape (not its references). Returns a clean copy. */
export function parseBillSpec(spec) {
  if (!spec || typeof spec !== "object") fail("Bill spec must be a JSON object");
  const customerid = num(spec.customerid, "customerid");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date ?? "") || Number.isNaN(Date.parse(spec.date))) {
    fail(`date: expected YYYY-MM-DD, got "${spec.date ?? ""}"`);
  }
  const method = String(spec.payment?.method ?? "").trim();
  if (!method) fail("payment.method is required (e.g. Cash, UPI)");
  const paid = num(spec.payment?.amount, "payment.amount");
  if (paid <= 0) fail("payment.amount must be > 0");
  if (!Array.isArray(spec.items) || spec.items.length === 0) fail("items: at least one item is required");

  const items = spec.items.map((it, i) => {
    const at = `items[${i}]`;
    const hasVariant = Boolean(it?.variantid);
    const hasManual = Boolean(it?.manual_item_id);
    if (hasVariant === hasManual) fail(`${at}: give exactly one of variantid or manual_item_id`);
    const qty = num(it.qty, `${at}.qty`);
    if (qty <= 0) fail(`${at}.qty must be > 0`);
    const stitch = it.stitch_type ?? "unstitched";
    if (!["stitched", "unstitched"].includes(stitch)) fail(`${at}.stitch_type must be stitched or unstitched`);
    const alteration = it.alteration_charge == null ? 0 : num(it.alteration_charge, `${at}.alteration_charge`);
    if (alteration < 0) fail(`${at}.alteration_charge must be >= 0`);
    const unit = it.unit_type ?? null;
    if (unit != null && !["piece", "meter"].includes(unit)) fail(`${at}.unit_type must be piece or meter`);
    const amount = it.amount == null ? null : num(it.amount, `${at}.amount`);
    if (amount != null && amount < 0) fail(`${at}.amount must be >= 0`);
    return {
      variantid: hasVariant ? String(it.variantid) : null,
      manual_item_id: hasManual ? String(it.manual_item_id).toUpperCase() : null,
      qty,
      amount,
      alteration_charge: alteration,
      stitch_type: stitch,
      unit_type: unit,
    };
  });

  return {
    customerid,
    date: spec.date,
    location: String(spec.location ?? DEFAULT_LOCATION).trim(),
    payment: { method, amount: paid },
    notes: spec.notes ? String(spec.notes) : null,
    skip_stock: Boolean(spec.skip_stock),
    items,
  };
}

async function one(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const byName = (rows, col, name) =>
  rows.find((r) => String(r[col]).toLowerCase() === name.toLowerCase());

/**
 * Resolves a spec against the database and computes everything createBill
 * would write. Read-only. Throws BillInputError for anything the billing
 * screen would refuse; returns non-blocking `warnings` for what it would ask
 * the user to acknowledge.
 */
export async function prepareBill(client, rawSpec) {
  const spec = parseBillSpec(rawSpec);
  const warnings = [];

  const variantIds = spec.items.filter((i) => i.variantid).map((i) => i.variantid);
  const manualIds = spec.items.filter((i) => i.manual_item_id).map((i) => i.manual_item_id);

  const [customer, methods, locations, variants, manuals] = await Promise.all([
    one(
      client.from("customers").select("customerid, first_name, last_name, phone").eq("customerid", spec.customerid).maybeSingle(),
    ),
    one(client.from("salesmethods").select("salesmethodid, methodname")),
    one(client.from("saleslocations").select("saleslocationid, locationname")),
    variantIds.length
      ? one(client.from("productsizecolors").select("variantid, productid, size, color, stock").in("variantid", variantIds))
      : [],
    manualIds.length
      ? one(client.from("manual_items").select("manual_item_id, name, categoryid, size, color, purchase_price, mrp").in("manual_item_id", manualIds))
      : [],
  ]);
  if (!customer) fail(`Customer ${spec.customerid} not found`);

  const method = byName(methods ?? [], "methodname", spec.payment.method);
  // "Website" is reserved for online orders; the billing screen hides it.
  if (!method || method.methodname.toLowerCase() === "website") {
    const allowed = (methods ?? []).map((m) => m.methodname).filter((n) => n.toLowerCase() !== "website");
    fail(`Unknown payment method "${spec.payment.method}" (one of: ${allowed.join(", ")})`);
  }
  const location = byName(locations ?? [], "locationname", spec.location);
  if (!location) {
    fail(`Unknown location "${spec.location}" (one of: ${(locations ?? []).map((l) => l.locationname).join(", ")})`);
  }

  const variantById = Object.fromEntries((variants ?? []).map((v) => [v.variantid, v]));
  const manualById = Object.fromEntries((manuals ?? []).map((m) => [m.manual_item_id, m]));
  const productIds = [...new Set((variants ?? []).map((v) => v.productid))];
  const products = productIds.length
    ? await one(client.from("products").select("productid, name, categoryid, retailprice, unit_type").in("productid", productIds))
    : [];
  const productById = Object.fromEntries((products ?? []).map((p) => [p.productid, p]));

  // Item objects in the exact shape the billing screen's pickers build
  // (InventoryPicker / ManualItemForm), so billUtils prices them identically.
  const items = spec.items.map((it, i) => {
    const at = `items[${i}]`;
    let base;
    if (it.variantid) {
      const v = variantById[it.variantid] ?? fail(`${at}: variant ${it.variantid} not found`);
      const p = productById[v.productid] ?? fail(`${at}: product ${v.productid} not found`);
      base = {
        source: "inventory",
        productid: p.productid,
        variantid: v.variantid,
        product_name: p.name,
        category: p.categoryid || null,
        size: v.size || null,
        color: v.color || null,
        stock: v.stock,
        mrp: Number(p.retailprice || 0),
        unit_type: p.unit_type || "piece",
        // The billing screen does not set cost_price for inventory lines.
      };
    } else {
      const m = manualById[it.manual_item_id] ?? fail(`${at}: manual item ${it.manual_item_id} not found`);
      base = {
        source: "manual",
        productid: m.manual_item_id,
        product_name: m.name,
        category: m.categoryid || null,
        size: m.size || null,
        color: m.color || null,
        mrp: Number(m.mrp || 0),
        cost_price: Number(m.purchase_price),
        unit_type: m.categoryid?.startsWith("FAB-") ? "meter" : "piece",
      };
    }

    const gross = round2(base.mrp * it.qty);
    const amount = it.amount ?? gross;
    if (amount > gross) {
      fail(`${at}: amount ${amount} is above MRP ${base.mrp} × ${it.qty} = ${gross}; the bill cannot charge more than MRP`);
    }
    // The screen stores line discounts as a 2-decimal %. Round it DOWN so the
    // line lands on or a few paise above the slip amount; the balance discount
    // (computeBalanceAdjustedTotals) then trims the bill to exactly what was
    // paid, as staff get on the screen. Rounding to nearest (ItemRow's ₹ input)
    // can land below the amount paid, which nothing corrects.
    const pct = gross > 0 ? Math.floor(((gross - amount) / gross) * 100 * 100 + 1e-9) / 100 : 0;
    if (pct > MAX_LINE_DISCOUNT_PCT) {
      fail(`${at}: ${pct}% discount (${base.product_name}) is over the billing screen's ${MAX_LINE_DISCOUNT_PCT}% limit`);
    }
    if (pct > ACK_LINE_DISCOUNT_PCT) {
      warnings.push(`${at}: ${pct}% discount on ${base.product_name} (over ${ACK_LINE_DISCOUNT_PCT}%, the screen asks to confirm)`);
    }
    const perUnitAfterDisc = base.mrp * (1 - pct / 100);
    return {
      ...base,
      // Unit is picked per line on the screen; default as the screen does.
      unit_type: it.unit_type ?? base.unit_type,
      quantity: it.qty,
      quickDiscountPct: pct,
      alteration_charge: it.alteration_charge,
      stitchType: it.stitch_type,
      gstRate: it.stitch_type === "stitched" && perUnitAfterDisc > 2500 ? 18 : 5,
      salesperson_id: null,
    };
  });

  // Stock: the same check the screen runs before finalizing, summed per variant.
  const qtyByVariant = {};
  for (const it of items) if (it.variantid) qtyByVariant[it.variantid] = (qtyByVariant[it.variantid] ?? 0) + it.quantity;
  const stock = Object.entries(qtyByVariant).map(([variantid, qty]) => {
    const v = variantById[variantid];
    return {
      variantid,
      productid: v.productid,
      size: v.size,
      color: v.color,
      stock_before: Number(v.stock),
      change: spec.skip_stock ? 0 : -qty,
      stock_after: spec.skip_stock ? Number(v.stock) : Number(v.stock) - qty,
    };
  });
  if (!spec.skip_stock) {
    const short = stock.filter((s) => s.stock_after < 0);
    if (short.length) {
      fail(
        "Insufficient stock: " +
          short.map((s) => `${s.productid} ${s.color}/${s.size} has ${s.stock_before}, needs ${s.stock_before - s.stock_after}`).join("; "),
      );
    }
  }

  const computed = computeBillTotals(items, [], [], 0, 0, DOC_TYPE);
  const totals = computeBalanceAdjustedTotals(computed, {
    paymentAmount: spec.payment.amount,
    effectiveGrandTotal: computed.grandTotal,
    items,
    selectedCodes: [],
    allDiscounts: [],
    voucherPreTax: 0,
    docType: DOC_TYPE,
  });
  const diff = round2(spec.payment.amount - totals.grandTotal);
  if (Math.abs(diff) > PAYMENT_TOLERANCE) {
    fail(
      `Payment ${spec.payment.amount} differs from the bill total ${totals.grandTotal} by ${Math.abs(diff)} ` +
        `(over ₹${PAYMENT_TOLERANCE}); check line amounts — partial payment is not supported`,
    );
  }
  if (diff > 0) warnings.push(`Customer paid ₹${diff} more than the bill total ${totals.grandTotal} (the screen records it as is)`);

  const bill = {
    customerid: spec.customerid,
    notes: spec.notes,
    document_type: DOC_TYPE,
    totalamount: totals.grandTotal,
    gst_total: totals.gstTotal,
    discount_total: totals.itemLevelDiscountTotal + totals.overallDiscount + totals.balanceDiscount,
    taxable_total: totals.taxableTotal,
    paymentstatus: "finalized",
    finalized: true,
    applied_codes: [],
    payment_amount: spec.payment.amount,
    store_credit_used: 0,
    exchange_credit_used: 0,
    exchange_source_bill: null,
    exchange_cash_refund: 0,
    saleslocationid: location.saleslocationid,
    salesmethodid: method.salesmethodid,
    orderdate: spec.date + "T00:00:00+05:30",
  };
  const billItems = buildBillItemsPayload(null, items, totals.balanceDiscount || 0, totals.overallDiscount, DOC_TYPE);

  return {
    customer,
    payment_method: method.methodname,
    location: location.locationname,
    bill,
    bill_items: billItems,
    stock,
    totals: {
      mrp_total: totals.itemsSubtotal,
      line_discounts: totals.itemLevelDiscountTotal,
      balance_discount: totals.balanceDiscount,
      grand_total: totals.grandTotal,
      paid: spec.payment.amount,
    },
    warnings,
  };
}

/**
 * Creates a finalized bill, writing what BillingForm's direct Finalize writes,
 * in the same order: bill row (trigger assigns bill_number), bill_items
 * (bill row deleted if this fails), stock_adjust per inventory line, activity
 * log. A fully paid bill gets no bill_payments row — the screen records the
 * payment on the bill (payment_amount + salesmethodid). Stock failures do not
 * undo the bill (as in the screen); they are returned in stock_failures.
 */
export async function createBill(client, rawSpec, { dryRun = false, source = "via CLI" } = {}) {
  const prepared = await prepareBill(client, rawSpec);
  if (dryRun) return { dry_run: true, ...prepared };

  const { data: saved, error: billErr } = await client
    .from("bills")
    .insert(prepared.bill)
    .select("billid, bill_number")
    .single();
  if (billErr) throw new Error("Failed to save bill: " + billErr.message);

  const rows = prepared.bill_items.map((r) => ({ ...r, billid: saved.billid }));
  const { error: itemsErr } = await client.from("bill_items").insert(rows);
  if (itemsErr) {
    const { error: delErr } = await client.from("bills").delete().eq("billid", saved.billid);
    throw new Error(
      `Failed to save bill items: ${itemsErr.message}` +
        (delErr ? ` — AND removing bill ${saved.billid} failed: ${delErr.message}; delete it by hand` : ` (bill ${saved.billid} removed)`),
    );
  }

  const stockFailures = [];
  for (const s of prepared.stock) {
    if (s.change === 0) continue;
    const { error } = await client.rpc("stock_adjust", {
      p_variant: s.variantid,
      p_delta: s.change,
      p_reason: "bill_finalize",
      p_ref: String(saved.billid),
    });
    if (error) stockFailures.push({ variantid: s.variantid, change: s.change, error: error.message });
  }

  const { error: logErr } = await client.from("activity_log").insert({
    actor_id: null,
    action: "create",
    entity_type: "bill",
    entity_id: String(saved.bill_number || saved.billid),
    summary: `Finalized bill #${saved.bill_number || "(no number)"} for ${customerName(prepared.customer)} — ${money(prepared.totals.grand_total)}, ${rows.length} items (${source})`,
  });
  if (logErr) console.error("[activityLog] insert failed:", logErr.message);

  return {
    billid: saved.billid,
    bill_number: saved.bill_number,
    customer: prepared.customer,
    totals: prepared.totals,
    stock: prepared.stock,
    stock_failures: stockFailures,
    warnings: prepared.warnings,
  };
}

/** A bill with its items, payments, customer and each variant's current stock. */
export async function getBill(client, { billid, billNumber }) {
  if (billid == null && !billNumber) throw new BillInputError("Give a bill id or bill number");
  let q = client.from("bills").select("*");
  q = billid != null ? q.eq("billid", Number(billid)) : q.eq("bill_number", String(billNumber).trim().toUpperCase());
  const bill = await one(q.maybeSingle());
  if (!bill) return null;

  const [items, payments, customer, method, location] = await Promise.all([
    one(client.from("bill_items").select("*").eq("billid", bill.billid).order("bill_item_id")),
    one(client.from("bill_payments").select("*").eq("billid", bill.billid).order("payment_id")),
    bill.customerid != null
      ? one(client.from("customers").select("customerid, first_name, last_name, phone").eq("customerid", bill.customerid).maybeSingle())
      : null,
    bill.salesmethodid != null
      ? one(client.from("salesmethods").select("methodname").eq("salesmethodid", bill.salesmethodid).maybeSingle())
      : null,
    bill.saleslocationid != null
      ? one(client.from("saleslocations").select("locationname").eq("saleslocationid", bill.saleslocationid).maybeSingle())
      : null,
  ]);
  const variantIds = [...new Set((items ?? []).map((i) => i.variantid).filter(Boolean))];
  const variants = variantIds.length
    ? await one(client.from("productsizecolors").select("variantid, size, color, stock").in("variantid", variantIds))
    : [];
  const variantById = Object.fromEntries((variants ?? []).map((v) => [v.variantid, v]));

  return {
    ...bill,
    payment_method: method?.methodname ?? null,
    location: location?.locationname ?? null,
    customer,
    items: (items ?? []).map((i) => {
      const v = i.variantid ? variantById[i.variantid] : null;
      return v ? { ...i, size: v.size, color: v.color, current_stock: Number(v.stock) } : i;
    }),
    payments: payments ?? [],
  };
}

const FIND_LIMIT = 50;

/**
 * Bills matching all given filters, newest first (max 50), each with a short
 * line list — for spotting a slip that is already in the system. Filters:
 * customerid or phone, date range (from/to, YYYY-MM-DD, inclusive), and a
 * product code that must appear on the bill.
 */
export async function findBills(client, { customerid, phone, from, to, productCode } = {}) {
  const has = (v) => v != null && String(v).trim() !== "";
  if (![customerid, phone, from, to, productCode].some(has)) {
    throw new BillInputError("Give at least one filter: customer, phone, from, to or product");
  }
  for (const [k, v] of [["from", from], ["to", to]]) {
    if (has(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new BillInputError(`${k}: expected YYYY-MM-DD, got "${v}"`);
  }

  let custId = has(customerid) ? Number(customerid) : null;
  if (has(phone)) {
    const c = await findCustomerByPhone(client, phone);
    if (!c) return [];
    if (custId != null && custId !== c.customerid) return [];
    custId = c.customerid;
  }

  let billIds = null;
  if (has(productCode)) {
    const lines = await one(
      client.from("bill_items").select("billid").eq("product_code", normalizeProductCode(productCode)),
    );
    billIds = [...new Set((lines ?? []).map((l) => l.billid))];
    if (billIds.length === 0) return [];
  }

  let q = client
    .from("bills")
    .select("billid, bill_number, orderdate, customerid, totalamount, payment_amount, paymentstatus, finalized, document_type");
  if (custId != null) q = q.eq("customerid", custId);
  if (has(from)) q = q.gte("orderdate", from);
  if (has(to)) q = q.lte("orderdate", `${to}T23:59:59`);
  if (billIds) q = q.in("billid", billIds);
  const bills = (await one(q.order("orderdate", { ascending: false }).limit(FIND_LIMIT))) ?? [];
  if (bills.length === 0) return [];

  const ids = bills.map((b) => b.billid);
  const custIds = [...new Set(bills.map((b) => b.customerid).filter((v) => v != null))];
  const [items, customers] = await Promise.all([
    one(client.from("bill_items").select("billid, product_code, product_name, quantity, mrp, total").in("billid", ids).order("bill_item_id")),
    custIds.length
      ? one(client.from("customers").select("customerid, first_name, last_name, phone").in("customerid", custIds))
      : [],
  ]);
  const custById = Object.fromEntries((customers ?? []).map((c) => [c.customerid, c]));
  return bills.map((b) => ({
    ...b,
    customer: custById[b.customerid] ?? null,
    items: (items ?? []).filter((i) => i.billid === b.billid).map(({ billid, ...i }) => i),
  }));
}
