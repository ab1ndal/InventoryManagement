// src/admin/lib/bills.js
// Bill creation and read-back shared by the admin CLI and, later, the admin
// screens. createBill reproduces BillingForm's direct "Finalize" of a new bill
// (handleConfirmFinalize) for the common case: one customer, inventory and/or
// manual items, per-line discount and alteration, fully paid by one method.
// Out of scope: drafts, discount codes, vouchers, store credit, exchanges,
// partial payment, salespersons, PDF/SMS.
// A bill spec is one readable JSON per bill (see docs/admin-cli.md): customer
// by id, by phone (optionally created if missing) or as a new guest; lines by
// product code + colour/size, variant id, manual item id, or a manual item
// created inline. So a whole paper slip is one auditable command.
// Functions take the Supabase client; imports carry .js for Node ESM.
import {
  computeBillTotals,
  computeBalanceAdjustedTotals,
  round2,
} from "../components/billing/billUtils.js";
import { buildBillItemsPayload } from "../components/billing/stockHelpers.js";
import { customerName, money } from "../../utility/activitySummary.js";
import { findCustomerByPhone, createCustomer } from "./customers.js";
import { normalizeProductCode } from "./products.js";
import { createManualItem } from "./manualItems.js";

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

// Unknown keys are refused so a typo ("colour") fails the preview instead of
// being silently ignored.
function checkKeys(obj, allowed, at) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) fail(`${at}: unknown field(s) ${extra.join(", ")} (allowed: ${allowed.join(", ")})`);
}
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

const CUSTOMER_FIELDS = ["first", "last", "email", "address", "gender", "notes"];
const toCustomerInput = (c, phone) => ({
  first_name: c.first,
  last_name: c.last,
  phone,
  email: c.email,
  address: c.address,
  gender: c.gender,
  customer_notes: c.notes,
});

function parseCustomer(spec) {
  if (spec.customerid != null && spec.customer != null) fail("give customerid or customer, not both");
  if (spec.customerid != null) return { kind: "id", customerid: num(spec.customerid, "customerid") };
  const c = spec.customer;
  if (!isObj(c)) fail("customer is required: { id } | { phone[, create_if_missing] } | { create }");
  checkKeys(c, ["id", "phone", "create_if_missing", "create"], "customer");
  const forms = ["id", "phone", "create"].filter((k) => c[k] != null);
  if (forms.length !== 1) fail("customer: give exactly one of id, phone or create");
  if (c.id != null) return { kind: "id", customerid: num(c.id, "customer.id") };
  if (c.phone != null) {
    if (c.create_if_missing != null) {
      if (!isObj(c.create_if_missing)) fail("customer.create_if_missing must be an object");
      checkKeys(c.create_if_missing, CUSTOMER_FIELDS, "customer.create_if_missing");
    }
    return { kind: "phone", phone: String(c.phone), createIfMissing: c.create_if_missing ?? null };
  }
  if (c.create_if_missing != null) fail("customer.create_if_missing needs customer.phone");
  if (!isObj(c.create)) fail("customer.create must be an object");
  checkKeys(c.create, CUSTOMER_FIELDS, "customer.create");
  return { kind: "new", create: c.create };
}

const ITEM_FIELDS = [
  "product", "color", "size", "variantid", "manual_item_id", "manual_item",
  "qty", "amount", "alteration_charge", "stitch_type", "unit_type",
];
const MANUAL_CREATE_FIELDS = ["name", "category", "mrp", "cost", "size", "color"];

function parseItemRef(it, at) {
  const forms = ["product", "variantid", "manual_item_id", "manual_item"].filter((k) => it[k] != null);
  if (forms.length !== 1) fail(`${at}: give exactly one of product, variantid, manual_item_id or manual_item`);
  if ((it.color != null || it.size != null) && it.product == null) fail(`${at}: color/size only go with product`);
  if (it.product != null) {
    return {
      kind: "product",
      code: normalizeProductCode(it.product),
      color: it.color != null ? String(it.color).trim() : null,
      size: it.size != null ? String(it.size).trim() : null,
    };
  }
  if (it.variantid != null) return { kind: "variant", variantid: String(it.variantid) };
  if (it.manual_item_id != null) return { kind: "manual", id: String(it.manual_item_id).toUpperCase() };
  const m = it.manual_item;
  if (!isObj(m)) fail(`${at}.manual_item must be { id } or { create }`);
  checkKeys(m, ["id", "create"], `${at}.manual_item`);
  if ((m.id != null) === (m.create != null)) fail(`${at}.manual_item: give exactly one of id or create`);
  if (m.id != null) return { kind: "manual", id: String(m.id).toUpperCase() };
  if (!isObj(m.create)) fail(`${at}.manual_item.create must be an object`);
  checkKeys(m.create, MANUAL_CREATE_FIELDS, `${at}.manual_item.create`);
  return { kind: "manual_new", create: m.create };
}

/** Validates the bill spec's shape (not its references). Returns a clean copy. */
export function parseBillSpec(spec) {
  if (!isObj(spec)) fail("Bill spec must be a JSON object");
  checkKeys(spec, ["customer", "customerid", "date", "location", "payment", "notes", "skip_stock", "items"], "spec");
  const customer = parseCustomer(spec);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date ?? "") || Number.isNaN(Date.parse(spec.date))) {
    fail(`date: expected YYYY-MM-DD, got "${spec.date ?? ""}"`);
  }
  if (!isObj(spec.payment)) fail("payment is required: { method, amount }");
  checkKeys(spec.payment, ["method", "amount"], "payment");
  const method = String(spec.payment.method ?? "").trim();
  if (!method) fail("payment.method is required (e.g. Cash, UPI)");
  const paid = num(spec.payment.amount, "payment.amount");
  if (paid <= 0) fail("payment.amount must be > 0");
  if (!Array.isArray(spec.items) || spec.items.length === 0) fail("items: at least one item is required");

  const items = spec.items.map((it, i) => {
    const at = `items[${i}]`;
    if (!isObj(it)) fail(`${at} must be an object`);
    checkKeys(it, ITEM_FIELDS, at);
    const ref = parseItemRef(it, at);
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
      ref,
      qty,
      amount,
      alteration_charge: alteration,
      stitch_type: stitch,
      unit_type: unit,
    };
  });

  return {
    customer,
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

// Customer for the bill. A customer still to be created comes back with
// customerid null and its insert row in creates.customer.
async function resolveCustomer(client, ref, creates, warnings) {
  if (ref.kind === "id") {
    const c = await one(
      client.from("customers").select("customerid, first_name, last_name, phone").eq("customerid", ref.customerid).maybeSingle(),
    );
    if (!c) fail(`Customer ${ref.customerid} not found`);
    return c;
  }
  if (ref.kind === "phone") {
    const c = await findCustomerByPhone(client, ref.phone);
    if (c) {
      const want = ref.createIfMissing;
      if (want && customerName({ first_name: want.first, last_name: want.last }).toLowerCase() !== customerName(c).toLowerCase()) {
        warnings.push(`Phone ${c.phone} is customer ${c.customerid} (${customerName(c)}), not "${customerName({ first_name: want.first, last_name: want.last })}" as on the slip; billing the existing customer`);
      }
      return { customerid: c.customerid, first_name: c.first_name, last_name: c.last_name, phone: c.phone };
    }
    if (!ref.createIfMissing) {
      fail(`No customer with phone ${ref.phone}; add customer.create_if_missing { first, last } to create one`);
    }
    return planCustomer(client, toCustomerInput(ref.createIfMissing, ref.phone), creates);
  }
  return planCustomer(client, toCustomerInput(ref.create, null), creates);
}

async function planCustomer(client, input, creates) {
  const { would_insert: row } = await createCustomer(client, input, { dryRun: true });
  creates.customer = row;
  return { customerid: null, first_name: row.first_name, last_name: row.last_name, phone: row.phone };
}

// product + colour/size → the one matching variant; anything else is refused
// with the options listed, so the slip line can be corrected.
async function resolveProductRefs(client, items) {
  const codes = [...new Set(items.filter((i) => i.ref.kind === "product").map((i) => i.ref.code))];
  const variants = codes.length
    ? await one(client.from("productsizecolors").select("variantid, productid, size, color, stock").in("productid", codes))
    : [];
  const eqi = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();
  return items.map((it, i) => {
    const at = `items[${i}]`;
    const { ref } = it;
    if (ref.kind === "variant") return { ...it, variantid: ref.variantid };
    if (ref.kind === "manual") return { ...it, manual_item_id: ref.id };
    if (ref.kind === "manual_new") return { ...it, newManual: ref.create };
    const all = (variants ?? []).filter((v) => v.productid === ref.code);
    if (all.length === 0) fail(`${at}: no product ${ref.code} (or it has no variants); try product search`);
    const hits = all.filter((v) => (ref.color == null || eqi(v.color, ref.color)) && (ref.size == null || eqi(v.size, ref.size)));
    if (hits.length === 1) return { ...it, variantid: hits[0].variantid };
    const options = all.map((v) => `${v.color}/${v.size} (stock ${Number(v.stock)})`).join(", ");
    fail(
      hits.length === 0
        ? `${at}: ${ref.code} has no variant ${[ref.color, ref.size].filter(Boolean).join("/")}; variants: ${options}`
        : `${at}: ${ref.code} has ${hits.length} matching variants, add color/size; variants: ${options}`,
    );
    return null;
  });
}

// Manual items to create: validated with the form's rules and given the ids
// they will get (consecutive BCX numbers, in line order).
async function planManualItems(client, items, creates) {
  for (const [i, it] of items.entries()) {
    if (!it.newManual) continue;
    const c = it.newManual;
    let row;
    try {
      ({ would_insert: row } = await createManualItem(
        client,
        { name: c.name, categoryid: c.category, mrp: c.mrp, cost: c.cost, size: c.size, color: c.color },
        { dryRun: true },
      ));
    } catch (e) {
      if (e.name === "ManualItemInputError") fail(`items[${i}].manual_item.create: ${e.message}`);
      throw e;
    }
    const k = creates.manual_items.length;
    if (k > 0) {
      const prefix = row.manual_item_id.slice(0, 5);
      const next = Number(row.manual_item_id.slice(5)) + k;
      row = { ...row, manual_item_id: `${prefix}${String(next).padStart(3, "0")}` };
    }
    creates.manual_items.push(row);
    it.manual_item_id = row.manual_item_id;
  }
}

/**
 * Resolves a spec against the database and computes everything createBill
 * would write. Read-only. Throws BillInputError for anything the billing
 * screen would refuse; returns non-blocking `warnings` for what it would ask
 * the user to acknowledge.
 */
export async function prepareBill(client, rawSpec) {
  const spec = parseBillSpec(rawSpec);
  const warnings = [];
  const creates = { customer: null, manual_items: [] };

  const customer = await resolveCustomer(client, spec.customer, creates, warnings);
  const items0 = await resolveProductRefs(client, spec.items);
  await planManualItems(client, items0, creates);

  const variantIds = items0.filter((i) => i.variantid).map((i) => i.variantid);
  const manualIds = items0.filter((i) => i.manual_item_id && !i.newManual).map((i) => i.manual_item_id);

  const [methods, locations, variants, manuals] = await Promise.all([
    one(client.from("salesmethods").select("salesmethodid, methodname")),
    one(client.from("saleslocations").select("saleslocationid, locationname")),
    variantIds.length
      ? one(client.from("productsizecolors").select("variantid, productid, size, color, stock").in("variantid", variantIds))
      : [],
    manualIds.length
      ? one(client.from("manual_items").select("manual_item_id, name, categoryid, size, color, purchase_price, mrp").in("manual_item_id", manualIds))
      : [],
  ]);

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
  const manualById = Object.fromEntries(
    [...(manuals ?? []), ...creates.manual_items].map((m) => [m.manual_item_id, m]),
  );
  const productIds = [...new Set((variants ?? []).map((v) => v.productid))];
  const products = productIds.length
    ? await one(client.from("products").select("productid, name, categoryid, retailprice, unit_type").in("productid", productIds))
    : [];
  const productById = Object.fromEntries((products ?? []).map((p) => [p.productid, p]));

  // Item objects in the exact shape the billing screen's pickers build
  // (InventoryPicker / ManualItemForm), so billUtils prices them identically.
  const items = items0.map((it, i) => {
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
    customerid: customer.customerid,
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
    creates,
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
  const planned = await prepareBill(client, rawSpec);
  if (dryRun) return { dry_run: true, ...planned };

  const created = { customer: null, manual_items: [] };
  try {
    const resolved = await createReferenced(client, rawSpec, planned, created, source);
    // Re-resolve against the real rows (ids actually assigned) before writing.
    const prepared = resolved === rawSpec ? planned : await prepareBill(client, resolved);
    return { ...(await insertBill(client, prepared, source)), created };
  } catch (e) {
    if (!created.customer && created.manual_items.length === 0) throw e;
    const what = [
      created.customer && `customer ${created.customer.customerid}`,
      created.manual_items.length && `manual items ${created.manual_items.map((m) => m.manual_item_id).join(", ")}`,
    ].filter(Boolean).join(" and ");
    // Keep the type so input errors still exit 2; say what already exists so a
    // re-run uses it instead of creating duplicates.
    e.message = `${e.message} — NOTE: ${what} were already created; re-run with customer { id } / manual_item { id }`;
    throw e;
  }
}

// Creates the customer and manual items the spec asks for, returning the spec
// rewritten to reference them by id (or the same spec if nothing to create).
async function createReferenced(client, rawSpec, planned, created, source) {
  if (!planned.creates.customer && planned.creates.manual_items.length === 0) return rawSpec;
  const spec = parseBillSpec(rawSpec);
  const out = { ...rawSpec };
  if (planned.creates.customer) {
    const ref = spec.customer;
    const input = ref.kind === "phone" ? toCustomerInput(ref.createIfMissing, ref.phone) : toCustomerInput(ref.create, null);
    created.customer = await createCustomer(client, input, { source });
    delete out.customerid;
    out.customer = { id: created.customer.customerid };
  }
  out.items = [...rawSpec.items];
  // Sequential: each new item takes the next BCX number.
  for (const [i, it] of rawSpec.items.entries()) {
    const ref = spec.items[i].ref;
    if (ref.kind !== "manual_new") continue;
    const c = ref.create;
    const saved = await createManualItem(client, {
      name: c.name, categoryid: c.category, mrp: c.mrp, cost: c.cost, size: c.size, color: c.color,
    });
    created.manual_items.push(saved);
    const { manual_item, ...rest } = it;
    out.items[i] = { ...rest, manual_item_id: saved.manual_item_id };
  }
  return out;
}

async function insertBill(client, prepared, source) {
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
