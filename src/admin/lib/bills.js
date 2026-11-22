// src/admin/lib/bills.js
// Bill creation and read-back shared by the admin CLI and, later, the admin
// screens. createBill reproduces BillingForm's direct "Finalize" of a new bill
// (handleConfirmFinalize) for the common case: one customer, inventory and/or
// manual items, per-line discount and alteration, paid by one method, either
// in full or in part (handleConfirmPartialFinalize: first payment now, the
// rest owed), with the bill's salespersons as the screen's selector sets them.
// A spec with "draft": true is saved as the screen's Save Draft on a new bill
// (handleSaveDraft) instead. A spec's "exchange" pays for the bill with goods
// returned from an earlier bill, as the Exchange page and the screen record it
// (exchanges.js).
// Out of scope: discount codes, vouchers, store credit, per-line
// salespersons, finishing a draft, PDF/SMS.
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
import { computeCreditsApplied, computeExchangeBalance } from "../components/billing/exchangeHelpers.js";
import { buildBillItemsPayload } from "../components/billing/stockHelpers.js";
import { customerName, money, variantLabel } from "../../utility/activitySummary.js";
import { todayIST } from "../../utility/dateFormat.js";
import { findCustomerByPhone, createCustomer, findLikelyDuplicates, normalizePhone } from "./customers.js";
import { normalizeProductCode } from "./products.js";
import { createManualItem } from "./manualItems.js";
import { logActivityWith } from "./activity.js";
import { listSlipPhotos } from "./billSlipPhotos.js";
import { BILL_STATUS, billStatusFields, isDraft } from "./billStatus.js";
import { listSalespersons } from "./salespersons.js";
import { addStockByCode, undoStockAdds } from "./variants.js";
import { parseExchange, planExchange, recordExchange } from "./exchanges.js";

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

function parseCustomer(spec, draft) {
  if (spec.customerid != null && spec.customer != null) fail("give customerid or customer, not both");
  if (spec.customerid != null) return { kind: "id", customerid: num(spec.customerid, "customerid") };
  // The screen saves a draft with no customer (walk-in); only finishing it needs one.
  if (draft && spec.customer == null) return { kind: "none" };
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

// With an exchange, the credit may cover the whole bill: payment may then be left out, or 0 with
// no method. prepareBill refuses nothing paid if something is left to pay.
function parsePayment(p, { exchange = false } = {}) {
  if (exchange && p == null) return { method: "", amount: 0, balance_due: 0 };
  if (!isObj(p)) fail("payment is required: { method, amount }");
  checkKeys(p, ["method", "amount", "balance_due"], "payment");
  const paid = num(p.amount, "payment.amount");
  const balanceDue = p.balance_due == null ? 0 : num(p.balance_due, "payment.balance_due");
  if (balanceDue < 0) fail("payment.balance_due must be >= 0");
  // Nothing paid yet is allowed only on a part-paid bill, which then has no
  // payment method until its first payment (the screen's partial finalize).
  if (paid < 0 || (paid === 0 && balanceDue === 0 && !exchange)) fail("payment.amount must be > 0");
  const method = String(p.method ?? "").trim();
  if (paid > 0 && !method) fail("payment.method is required (e.g. Cash, UPI)");
  if (paid === 0 && method) fail("give no payment.method when nothing is paid yet");
  return { method, amount: paid, balance_due: balanceDue };
}

// Save Draft checks no payment (handleSaveDraft): none, an amount without a
// method or a method without an amount is saved as entered. Finishing the
// draft checks it.
function parseDraftPayment(p) {
  if (p == null) return { method: "", amount: null, balance_due: 0 };
  if (!isObj(p)) fail("payment must be an object: { method, amount }");
  checkKeys(p, ["method", "amount", "balance_due"], "payment");
  const amount = p.amount == null ? null : num(p.amount, "payment.amount");
  if (amount != null && amount < 0) fail("payment.amount must be >= 0");
  const balanceDue = p.balance_due == null ? 0 : num(p.balance_due, "payment.balance_due");
  if (balanceDue < 0) fail("payment.balance_due must be >= 0");
  return { method: String(p.method ?? "").trim(), amount, balance_due: balanceDue };
}

const STOCK_ADD_FIELDS = ["code", "size", "color", "qty", "new_variant"];

// Stock to add before the bill, as `stock add` would (a piece on the shelf but not in the inventory).
function parseStockAdds(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) fail("stock_adds must be a list of { code, size, color, qty[, new_variant] }");
  return list.map((a, i) => {
    const at = `stock_adds[${i}]`;
    if (!isObj(a)) fail(`${at} must be an object`);
    checkKeys(a, STOCK_ADD_FIELDS, at);
    for (const k of ["code", "size", "color"]) {
      if (a[k] == null || String(a[k]).trim() === "") fail(`${at}.${k} is required`);
    }
    const qty = num(a.qty, `${at}.qty`);
    if (qty <= 0) fail(`${at}.qty must be > 0`);
    const newVariant = a.new_variant ?? false;
    if (typeof newVariant !== "boolean") fail(`${at}.new_variant must be true or false`);
    return { code: String(a.code), size: String(a.size).trim(), color: String(a.color).trim(), qty, new_variant: newVariant };
  });
}

/** Validates the bill spec's shape (not its references). Returns a clean copy. */
export function parseBillSpec(spec) {
  if (!isObj(spec)) fail("Bill spec must be a JSON object");
  checkKeys(
    spec,
    ["customer", "customerid", "date", "location", "payment", "notes", "skip_stock", "salespersons", "draft", "stock_adds", "sold_total", "exchange", "items"],
    "spec",
  );
  const draft = spec.draft ?? false;
  if (typeof draft !== "boolean") fail(`draft must be true or false, got ${JSON.stringify(spec.draft)}`);
  const customer = parseCustomer(spec, draft);
  const salespersons = spec.salespersons ?? [];
  if (!Array.isArray(salespersons)) fail('salespersons must be a list of names or ids, e.g. ["Asha", 3]');
  for (const [i, s] of salespersons.entries()) {
    const ok = (typeof s === "string" && s.trim() !== "") || Number.isInteger(s);
    if (!ok) fail(`salespersons[${i}]: expected a name or id, got ${JSON.stringify(s)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.date ?? "") || Number.isNaN(Date.parse(spec.date))) {
    fail(`date: expected YYYY-MM-DD, got "${spec.date ?? ""}"`);
  }
  const exchange = spec.exchange == null ? null : parseExchange(spec.exchange);
  if (exchange && draft) fail("exchange is not supported on a draft bill");
  const payment = draft ? parseDraftPayment(spec.payment) : parsePayment(spec.payment, { exchange: Boolean(exchange) });
  if (!Array.isArray(spec.items) || spec.items.length === 0) fail("items: at least one item is required");
  const soldTotal = spec.sold_total == null ? null : num(spec.sold_total, "sold_total");
  if (soldTotal != null && soldTotal <= 0) fail("sold_total must be > 0");
  if (soldTotal != null && spec.items.some((it) => isObj(it) && it.amount != null)) {
    fail("give sold_total or line amounts, not both");
  }

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
    payment,
    notes: spec.notes ? String(spec.notes) : null,
    skip_stock: Boolean(spec.skip_stock),
    draft,
    salespersons: salespersons.map((s) => (typeof s === "string" ? s.trim() : s)),
    stock_adds: parseStockAdds(spec.stock_adds),
    sold_total: soldTotal,
    exchange,
    items,
  };
}

const ROUND_TO = 10;

/**
 * Splits what a slip says was paid for several lines into per-line amounts by each line's share
 * of the MRP (grosses = MRP × qty per line), rounded to the nearest ₹10 so each line reads as
 * what that piece sold for (owner rule 2026-11-11: 792.22 / 1057.78 → 790 / 1060). The line with
 * the largest MRP takes the remainder, so the amounts always add up to the total. If rounding
 * would push that line past its MRP or below 0, the shares are kept to the paisa instead.
 * A total at or above the MRP total leaves every line at its MRP.
 */
export function splitByMrpShare(total, grosses) {
  const sum = grosses.reduce((s, g) => s + g, 0);
  if (grosses.length === 1) return [round2(total)];
  if (total >= sum) return grosses.map(round2);
  const big = grosses.indexOf(Math.max(...grosses));
  const fill = (amounts) => {
    const others = amounts.reduce((s, a, i) => (i === big ? s : s + a), 0);
    return amounts.map((a, i) => (i === big ? round2(total - others) : a));
  };
  const rounded = fill(grosses.map((g) => Math.min(g, Math.round((total * g) / sum / ROUND_TO) * ROUND_TO)));
  if (rounded[big] >= 0 && rounded[big] <= grosses[big]) return rounded;
  return fill(grosses.map((g) => round2((total * g) / sum)));
}

async function one(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const byName = (rows, col, name) =>
  rows.find((r) => String(r[col]).toLowerCase() === name.toLowerCase());

// The `stock add` command that would let a refused line through, for when the piece is on the
// shelf but not in the inventory. Size and colour in single quotes: a size like XL|42 has a pipe.
const shellArg = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const stockAddCommand = ({ code, size, color, qty, newVariant = false }) =>
  `stock add --code ${code} --size ${shellArg(size)} --color ${shellArg(color)} --qty ${qty}${newVariant ? " --new-variant" : ""}`;

// Spec names (case-insensitive) or ids → the bill's salespersons, in spec
// order without repeats. Only active ones, as the screen's selector offers.
export function resolveSalespersons(rows, refs) {
  const active = rows.filter((r) => r.active !== false);
  const options = () => active.map((r) => `${r.name} (${r.salesperson_id})`).join(", ") || "none";
  const out = [];
  for (const ref of refs) {
    const isId = typeof ref === "number" || /^\d+$/.test(ref);
    const named = isId
      ? rows.filter((r) => r.salesperson_id === Number(ref))
      : rows.filter((r) => String(r.name).trim().toLowerCase() === ref.toLowerCase());
    // A name shared with a former salesperson means the active one.
    const hits = named.length > 1 && named.some((r) => r.active !== false) ? named.filter((r) => r.active !== false) : named;
    const label = isId ? `id ${ref}` : `"${ref}"`;
    if (hits.length === 0) fail(`Unknown salesperson ${label} (one of: ${options()})`);
    if (hits.length > 1) fail(`Salesperson ${label} matches ids ${hits.map((r) => r.salesperson_id).join(", ")}; give the id`);
    const sp = hits[0];
    if (sp.active === false) fail(`Salesperson ${sp.name} (${sp.salesperson_id}) is not active; the billing screen does not offer them`);
    if (!out.some((o) => o.salesperson_id === sp.salesperson_id)) out.push({ salesperson_id: sp.salesperson_id, name: sp.name });
  }
  return out;
}

// Customer for the bill. A customer still to be created comes back with
// customerid null and its insert row in creates.customer.
async function resolveCustomer(client, ref, creates, warnings) {
  if (ref.kind === "none") return null;
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

// A customer about to be created may already exist under the same name or with the slip's phone
// misread by a digit. Warned, not refused: same names are common, and the operator decides.
async function duplicateCustomerWarnings(client, row) {
  const { same_name, near_phone } = await findLikelyDuplicates(client, row);
  const who = (c) => `customer ${c.customerid} (${customerName(c)}, ${c.phone || "no phone"})`;
  return [
    ...same_name.map((c) => `Possible duplicate: ${who(c)} has the same name; if it is them, bill customer { id: ${c.customerid} } instead of creating a new customer`),
    ...near_phone.map((c) => `Possible duplicate: ${who(c)} has a phone one digit off ${row.phone}; check the slip's phone`),
  ];
}

// A variant a stock add will create has no id until it is created; the plan names it by this key.
const NEW_VARIANT = "new:";
const newVariantKey = (a) => `${NEW_VARIANT}${a.productid}:${a.color}/${a.size}`;

// The spec's stock adds, checked and looked up exactly as `stock add --dry-run` does (same
// function), each with the stock it leaves, counting an earlier add to the same variant.
async function planStockAdds(client, adds) {
  const planned = [];
  for (const [i, a] of adds.entries()) {
    let r;
    try {
      r = await addStockByCode(
        client,
        { code: a.code, size: a.size, color: a.color, quantity: a.qty, allowNewVariant: a.new_variant },
        { dryRun: true },
      );
    } catch (e) {
      if (e.name === "VariantInputError") fail(`stock_adds[${i}]: ${e.message}`);
      throw e;
    }
    const earlier = planned.findLast((p) => p.productid === r.productid && p.size === r.size && p.color === r.color);
    const before = earlier ? earlier.stock : r.stock_before;
    planned.push({
      productid: r.productid,
      name: r.name,
      size: r.size,
      color: r.color,
      variantid: earlier?.variantid ?? r.variantid ?? newVariantKey(r),
      created: earlier ? false : r.created,
      qty: a.qty,
      stock_before: before,
      stock: Math.round((before + a.qty) * 1000) / 1000,
    });
  }
  return planned;
}

// Variant rows as they will be once the planned stock adds are applied: the stock they leave,
// and the variants they create.
function withStockAdds(rows, adds) {
  const out = (rows ?? []).map((v) => ({ ...v }));
  for (const a of adds) {
    const v = out.find((r) => r.variantid === a.variantid);
    if (v) v.stock = a.stock;
    else out.push({ variantid: a.variantid, productid: a.productid, size: a.size, color: a.color, stock: a.stock });
  }
  return out;
}

// product + colour/size → the one matching variant; anything else is refused
// with the options listed, so the slip line can be corrected.
async function resolveProductRefs(client, items, stockAdds) {
  const codes = [...new Set(items.filter((i) => i.ref.kind === "product").map((i) => i.ref.code))];
  const variants = withStockAdds(
    codes.length
      ? await one(client.from("productsizecolors").select("variantid, productid, size, color, stock").in("productid", codes))
      : [],
    stockAdds,
  );
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
    if (hits.length > 1) fail(`${at}: ${ref.code} has ${hits.length} matching variants, add color/size; variants: ${options}`);
    // A size or colour the line leaves out is the product's only one, if it has just one.
    const only = (col) => {
      const values = [...new Set(all.map((v) => v[col]))];
      return values.length === 1 ? values[0] : `<${col}>`;
    };
    const fix = stockAddCommand({
      code: ref.code, size: ref.size ?? only("size"), color: ref.color ?? only("color"), qty: it.qty, newVariant: true,
    });
    fail(
      `${at}: ${ref.code} has no variant ${[ref.color, ref.size].filter(Boolean).join("/")}; variants: ${options}. ` +
        `If the piece is on the shelf, add it: ${fix}`,
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
  if (creates.customer) warnings.push(...(await duplicateCustomerWarnings(client, creates.customer)));
  const exchange = spec.exchange
    ? await planExchange(client, spec.exchange, { customerid: customer?.customerid ?? null, date: spec.date })
    : null;
  if (exchange) warnings.push(...exchange.warnings);
  // The bill is checked as if the stock adds were already applied (createBill applies them first).
  const stockAdds = await planStockAdds(client, spec.stock_adds);
  const items0 = await resolveProductRefs(client, spec.items, stockAdds);
  await planManualItems(client, items0, creates);

  const variantIds = items0.filter((i) => i.variantid && !i.variantid.startsWith(NEW_VARIANT)).map((i) => i.variantid);
  const manualIds = items0.filter((i) => i.manual_item_id && !i.newManual).map((i) => i.manual_item_id);

  const [methods, locations, salespersonRows, variants, manuals] = await Promise.all([
    one(client.from("salesmethods").select("salesmethodid, methodname")),
    one(client.from("saleslocations").select("saleslocationid, locationname")),
    spec.salespersons.length ? listSalespersons(client) : [],
    variantIds.length
      ? one(client.from("productsizecolors").select("variantid, productid, size, color, stock").in("variantid", variantIds))
      : [],
    manualIds.length
      ? one(client.from("manual_items").select("manual_item_id, name, categoryid, size, color, purchase_price, mrp").in("manual_item_id", manualIds))
      : [],
  ]);

  const method = spec.payment.method ? byName(methods ?? [], "methodname", spec.payment.method) : null;
  // "Website" is reserved for online orders; the billing screen hides it.
  if (spec.payment.method && (!method || method.methodname.toLowerCase() === "website")) {
    const allowed = (methods ?? []).map((m) => m.methodname).filter((n) => n.toLowerCase() !== "website");
    fail(`Unknown payment method "${spec.payment.method}" (one of: ${allowed.join(", ")})`);
  }
  const location = byName(locations ?? [], "locationname", spec.location);
  if (!location) {
    fail(`Unknown location "${spec.location}" (one of: ${(locations ?? []).map((l) => l.locationname).join(", ")})`);
  }
  const salespersons = resolveSalespersons(salespersonRows, spec.salespersons);

  const plannedVariants = withStockAdds(variants, stockAdds);
  const variantById = Object.fromEntries(plannedVariants.map((v) => [v.variantid, v]));
  const manualById = Object.fromEntries(
    [...(manuals ?? []), ...creates.manual_items].map((m) => [m.manual_item_id, m]),
  );
  const productIds = [...new Set(plannedVariants.map((v) => v.productid))];
  const products = productIds.length
    ? await one(client.from("products").select("productid, name, categoryid, retailprice, unit_type").in("productid", productIds))
    : [];
  const productById = Object.fromEntries((products ?? []).map((p) => [p.productid, p]));

  // Item objects in the exact shape the billing screen's pickers build
  // (InventoryPicker / ManualItemForm), so billUtils prices them identically.
  const bases = items0.map((it, i) => {
    const at = `items[${i}]`;
    if (it.variantid) {
      const v = variantById[it.variantid] ?? fail(`${at}: variant ${it.variantid} not found`);
      const p = productById[v.productid] ?? fail(`${at}: product ${v.productid} not found`);
      return {
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
    }
    const m = manualById[it.manual_item_id] ?? fail(`${at}: manual item ${it.manual_item_id} not found`);
    return {
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
  });
  const grosses = bases.map((base, i) => round2(base.mrp * items0[i].qty));
  const soldSplit = spec.sold_total != null ? splitByMrpShare(spec.sold_total, grosses) : null;
  const amounts = soldSplit ?? items0.map((it) => it.amount);

  const items = items0.map((it, i) => {
    const at = `items[${i}]`;
    const base = bases[i];
    const gross = grosses[i];
    const amount = amounts[i] ?? gross;
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

  // Stock: the same check the screen runs before finalizing, summed per variant. Pieces the
  // exchange returns are back on the shelf first (exchange_record runs before the bill).
  const backByVariant = {};
  for (const r of exchange?.returned ?? []) {
    if (r.stock) backByVariant[r.stock.variantid] = (backByVariant[r.stock.variantid] ?? 0) + r.qty;
  }
  const qtyByVariant = {};
  for (const it of items) if (it.variantid) qtyByVariant[it.variantid] = (qtyByVariant[it.variantid] ?? 0) + it.quantity;
  const stock = Object.entries(qtyByVariant).map(([variantid, qty]) => {
    const v = variantById[variantid];
    const before = Number(v.stock) + (backByVariant[variantid] ?? 0);
    return {
      variantid,
      productid: v.productid,
      size: v.size,
      color: v.color,
      stock_before: before,
      change: spec.skip_stock ? 0 : -qty,
      stock_after: spec.skip_stock ? before : before - qty,
    };
  });
  if (!spec.skip_stock) {
    const short = stock.filter((s) => s.stock_after < 0);
    if (short.length) {
      fail(
        "Insufficient stock: " +
          short.map((s) => `${s.productid} ${s.color}/${s.size} has ${s.stock_before}, needs ${s.stock_before - s.stock_after}`).join("; ") +
          ". If the pieces are on the shelf, add them: " +
          short.map((s) => stockAddCommand({ code: s.productid, size: s.size, color: s.color, qty: Math.round(-s.stock_after * 1000) / 1000 })).join("; "),
      );
    }
  }

  const computed = computeBillTotals(items, [], [], 0, 0, DOC_TYPE);
  if (spec.draft) {
    return prepareDraft(spec, { customer, creates, method, location, salespersons, items, stock, stockAdds, computed, warnings, soldSplit });
  }

  // A part-paid bill is priced at what the customer agreed to pay in all (the
  // screen's "final amount"); the first payment is only part of it.
  const partial = spec.payment.balance_due > 0;
  const agreed = round2(spec.payment.amount + spec.payment.balance_due);
  // Exchange credit comes off the total before the payment is checked against it, as the screen
  // does (computeCreditsApplied; no store credit).
  const exchangeCredit = exchange?.credit ?? 0;
  const { effectiveTotal: effectiveGrandTotal } = computeCreditsApplied(computed.grandTotal, 0, exchangeCredit);
  const totals = computeBalanceAdjustedTotals(computed, {
    finalAmount: partial ? agreed : undefined,
    paymentAmount: spec.payment.amount,
    effectiveGrandTotal,
    items,
    selectedCodes: [],
    allDiscounts: [],
    voucherPreTax: 0,
    docType: DOC_TYPE,
  });
  // The screen asks for payment whenever something is left to pay.
  if (exchange && effectiveGrandTotal > 0 && agreed === 0) {
    fail(`payment is required: ₹${round2(effectiveGrandTotal)} is left to pay after the exchange credit of ₹${exchangeCredit}`);
  }
  // Against the line total before the balance discount: the screen's final
  // amount would otherwise discount away any shortfall.
  const diff = round2(agreed - effectiveGrandTotal);
  const dueText = exchange
    ? `what is left to pay after the exchange credit (bill total ${computed.grandTotal} − credit ${exchangeCredit} = ${round2(effectiveGrandTotal)})`
    : `the bill total ${computed.grandTotal}`;
  if (Math.abs(diff) > PAYMENT_TOLERANCE) {
    fail(
      `Payment ${agreed}${partial ? ` (${spec.payment.amount} paid + ${spec.payment.balance_due} due)` : ""} ` +
        `differs from ${dueText} by ${Math.abs(diff)} (over ₹${PAYMENT_TOLERANCE}); ` +
        `check line amounts, or give payment.balance_due for a part payment`,
    );
  }
  if (diff > 0) warnings.push(`Customer paid ₹${diff} more than ${dueText} (the screen records it as is)`);

  const { exchangeCreditUsed, effectiveTotal } = computeCreditsApplied(totals.grandTotal, 0, exchangeCredit);
  const exchangeBalance = computeExchangeBalance(totals.grandTotal, 0, exchangeCredit);
  const balanceTo = spec.exchange?.balance ?? null;
  if (exchange) {
    if (exchangeBalance > 0) {
      if (partial) fail(`The exchange credit ₹${exchangeCredit} covers the whole bill, so there is no balance_due`);
      if (!balanceTo) {
        fail(
          `The exchange credit ₹${exchangeCredit} is ₹${exchangeBalance} more than the bill total ${totals.grandTotal}: ` +
            `give exchange.balance "store_credit" or "cash_refund", as the screen asks`,
        );
      }
      if (balanceTo === "store_credit" && !customer?.customerid) fail("exchange.balance store_credit needs a customer");
    } else if (balanceTo) {
      fail(`exchange.balance is only for credit left over, and the bill total ${totals.grandTotal} uses all ₹${exchangeCredit} of it`);
    }
  }
  const cashRefund = !partial && balanceTo === "cash_refund" ? exchangeBalance : 0;

  const bill = {
    customerid: customer.customerid,
    notes: spec.notes,
    document_type: DOC_TYPE,
    totalamount: totals.grandTotal,
    gst_total: totals.gstTotal,
    discount_total: totals.itemLevelDiscountTotal + totals.overallDiscount + totals.balanceDiscount,
    taxable_total: totals.taxableTotal,
    ...(partial ? { net_amount: effectiveTotal, final_amount: agreed } : {}),
    ...billStatusFields(partial ? BILL_STATUS.PARTIAL : BILL_STATUS.FINALIZED),
    // Bill cancel restores stock only when this is true; the column defaults to true.
    stock_reduced: !spec.skip_stock,
    applied_codes: [],
    payment_amount: spec.payment.amount,
    store_credit_used: 0,
    exchange_credit_used: exchangeCreditUsed,
    exchange_source_bill: exchange?.source_bill ?? null,
    exchange_cash_refund: cashRefund,
    saleslocationid: location.saleslocationid,
    salesmethodid: method?.salesmethodid ?? null,
    orderdate: spec.date + "T00:00:00+05:30",
  };
  const billItems = buildBillItemsPayload(null, items, totals.balanceDiscount || 0, totals.overallDiscount, DOC_TYPE);

  return {
    status: bill.paymentstatus,
    customer,
    creates,
    payment_method: method?.methodname ?? null,
    location: location.locationname,
    // The bill's salespeople (bill_salespersons rows), as the screen's selector sets them.
    salespersons,
    bill,
    bill_items: billItems,
    stock,
    stock_adds: stockAdds,
    // What each line sold for, from sold_total split by MRP share.
    ...(soldSplit ? { sold_split: soldSplit } : {}),
    // The goods returned (or credit recorded earlier) that pay for part of the bill.
    ...(exchange
      ? {
          exchange: {
            kind: exchange.kind,
            source_bill: exchange.source_bill,
            returned: exchange.returned,
            exchange_ids: exchange.exchange_ids,
            credit: exchangeCredit,
            credit_used: exchangeCreditUsed,
            balance: exchangeBalance,
            balance_to: exchangeBalance > 0 ? balanceTo : null,
            // exchange_record's arguments (goods returned now), written before the bill.
            record: exchange.record,
            outside_window: exchange.outside_window,
          },
        }
      : {}),
    totals: {
      mrp_total: totals.itemsSubtotal,
      line_discounts: totals.itemLevelDiscountTotal,
      balance_discount: totals.balanceDiscount,
      grand_total: totals.grandTotal,
      ...(exchange ? { exchange_credit: exchangeCreditUsed, net_due: round2(effectiveTotal) } : {}),
      paid: spec.payment.amount,
      ...(partial ? { balance_due: spec.payment.balance_due } : {}),
    },
    // The first payment's ledger row, written only for a part-paid bill. A
    // backdated payment is stored at midday, as the screen does (recorded_at
    // has no time zone).
    first_payment: partial && spec.payment.amount > 0
      ? {
          amount: spec.payment.amount,
          salesmethodid: method.salesmethodid,
          ...(spec.date === todayIST() ? {} : { recorded_at: `${spec.date}T12:00:00` }),
        }
      : null,
    warnings,
  };
}

// The plan for a draft, as the screen's Save Draft on a new bill builds it
// (BillingForm.handleSaveDraft): the line totals as they stand, with no balance
// discount and no payment check (finishing the draft does both), and the
// payment fields as entered. The stock check before it is the same as for a
// finalized bill, since a draft takes its stock when saved.
function prepareDraft(spec, { customer, creates, method, location, salespersons, items, stock, stockAdds, computed, warnings, soldSplit }) {
  const p = spec.payment;
  // The screen's "final amount": what the customer agreed to pay in all.
  const finalAmount = p.balance_due > 0 ? round2((p.amount ?? 0) + p.balance_due) : null;
  return {
    status: BILL_STATUS.DRAFT,
    customer,
    creates,
    payment_method: method?.methodname ?? null,
    location: location.locationname,
    salespersons,
    // Exactly the row the screen inserts; bill_save has no op for a new draft.
    bill: {
      customerid: customer?.customerid ?? null,
      stock_reduced: !spec.skip_stock,
      notes: spec.notes,
      document_type: DOC_TYPE,
      totalamount: computed.grandTotal,
      gst_total: computed.gstTotal,
      discount_total: computed.itemLevelDiscountTotal + computed.overallDiscount,
      taxable_total: computed.taxableTotal,
      ...billStatusFields(BILL_STATUS.DRAFT),
      applied_codes: [],
      payment_amount: p.amount,
      final_amount: finalAmount,
      saleslocationid: location.saleslocationid,
      salesmethodid: method?.salesmethodid ?? null,
      orderdate: spec.date + "T00:00:00+05:30",
    },
    bill_items: buildBillItemsPayload(null, items, 0, computed.overallDiscount, DOC_TYPE),
    stock,
    stock_adds: stockAdds,
    ...(soldSplit ? { sold_split: soldSplit } : {}),
    totals: {
      mrp_total: computed.itemsSubtotal,
      line_discounts: computed.itemLevelDiscountTotal,
      balance_discount: 0,
      grand_total: computed.grandTotal,
      paid: p.amount,
      ...(p.balance_due > 0 ? { balance_due: p.balance_due } : {}),
    },
    first_payment: null,
    warnings,
  };
}

/**
 * Creates a finalized bill through bill_save, as BillingForm's Finalize and
 * Partial Payment do: the bill row (trigger assigns bill_number), bill_items,
 * stock and, for a part-paid bill, its first bill_payments row are one
 * transaction, so a failure leaves nothing behind and no bill is ever deleted
 * to undo one. A fully paid bill gets no bill_payments row — the screen
 * records the payment on the bill (payment_amount + salesmethodid). The
 * activity log is written after the save. negative_stock lists any variant the
 * save took below zero (only possible if stock moved since the preview).
 * A draft spec is saved as the screen saves a new draft instead (insertDraft).
 * The spec's stock_adds go into the same transaction as a finalized or part-paid bill
 * (bill_save_with_stock_adds), so a failure leaves neither and there is nothing to undo. A draft
 * has no bill_save op, so its stock adds are applied first with `stock add`'s writes and undone
 * (undoStockAdds) if the draft then fails, with the error saying how that went.
 * An exchange returning goods is recorded first with exchange_record, as the Exchange page does
 * before the bill screen opens; bill_save then spends its credit. Those are two transactions, as
 * in the app: if the bill then fails, the exchange stays recorded (stock back, credit unspent) and
 * the error gives the exchange ids to re-run with.
 */
export async function createBill(client, rawSpec, { dryRun = false, source = "via CLI" } = {}) {
  const planned = await prepareBill(client, rawSpec);
  if (dryRun) return { dry_run: true, ...planned };

  const created = { customer: null, manual_items: [] };
  const stockAdded = [];
  try {
    const resolved = await createReferenced(client, rawSpec, planned, created, source);
    if (planned.status !== BILL_STATUS.DRAFT) {
      // Re-resolve against the rows createReferenced made (ids actually assigned) before writing.
      const prepared = resolved !== rawSpec ? await prepareBill(client, resolved) : planned;
      const ex = prepared.exchange;
      const exchangeIds = ex?.record ? await recordExchange(client, ex, { source }) : ex?.exchange_ids ?? [];
      let saved;
      try {
        saved = await insertBill(client, prepared, source, exchangeIds);
      } catch (e) {
        if (ex?.record) {
          e.message +=
            ` — the exchange WAS recorded (exchange ids ${exchangeIds.join(", ")}, credit ₹${ex.credit}, returned stock is back) and its credit is not spent:` +
            ` re-run with "exchange": {"exchange_ids": ${JSON.stringify(exchangeIds)}${ex.balance_to ? `, "balance": "${ex.balance_to}"` : ""}}`;
        }
        throw e;
      }
      // The re-resolved plan bills the new customer by id, so keep the first plan's warnings
      // (possible duplicate customers) in the output too.
      return { ...saved, warnings: [...new Set([...planned.warnings, ...saved.warnings])], created };
    }
    for (const a of planned.stock_adds) {
      const r = await addStockByCode(client, {
        code: a.productid, size: a.size, color: a.color, quantity: a.qty, allowNewVariant: a.created,
      });
      stockAdded.push({ ...r, qty: a.qty });
    }
    let prepared = planned;
    if (resolved !== rawSpec || stockAdded.length) {
      // Re-resolve against the real rows (ids actually assigned, stock added) before writing.
      const billSpec = { ...resolved };
      delete billSpec.stock_adds;
      prepared = await prepareBill(client, billSpec);
    }
    const saved = await insertDraft(client, prepared, source);
    // The re-resolved plan bills the new customer by id, so keep the first plan's warnings
    // (possible duplicate customers) in the output too.
    return {
      ...saved,
      warnings: [...new Set([...planned.warnings, ...saved.warnings])],
      ...(stockAdded.length && { stock_adds: stockAdded }),
      created,
    };
  } catch (e) {
    const notes = [];
    if (stockAdded.length) notes.push(await undoStockAdds(client, stockAdded));
    if (created.customer || created.manual_items.length) {
      const what = [
        created.customer && `customer ${created.customer.customerid}`,
        created.manual_items.length && `manual items ${created.manual_items.map((m) => m.manual_item_id).join(", ")}`,
      ].filter(Boolean).join(" and ");
      // Say what already exists so a re-run uses it instead of creating duplicates.
      notes.push(`NOTE: ${what} were already created; re-run with customer { id } / manual_item { id }`);
    }
    if (!notes.length) throw e;
    // Keep the type so input errors still exit 2.
    e.message = `${e.message} — ${notes.join(" — ")}`;
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

// A variant a stock add creates gets its real id here, made client-side as addVariantStock makes
// one, so the bill lines can name it in the same call that creates it. Adds to the same new
// variant share its id.
function withNewVariantIds(prepared) {
  const ids = new Map();
  const real = (id) => {
    if (!id?.startsWith(NEW_VARIANT)) return id;
    if (!ids.has(id)) ids.set(id, crypto.randomUUID());
    return ids.get(id);
  };
  return {
    stockAdds: prepared.stock_adds.map((a) => ({ ...a, variantid: real(a.variantid) })),
    items: prepared.bill_items.map((it) => (it.variantid ? { ...it, variantid: real(it.variantid) } : it)),
  };
}

// The activity entries addVariantStock writes for the same change.
const stockAddSummary = (a, source) =>
  a.created
    ? `Added variant ${variantLabel(a.size, a.color)} to product ${a.productid} — ${a.name} (stock ${a.qty}) (${source})`
    : `Increased stock of ${variantLabel(a.size, a.color)}, product ${a.productid} — ${a.name}: ${a.stock_before} → ${a.stock} (+${a.qty}) (${source})`;

async function insertBill(client, prepared, source, exchangeIds = []) {
  // bill_save takes the "don't reduce stock" choice as skip_stock and records stock_reduced from
  // it, so the bill row goes without that column.
  const { stock_reduced: stockReduced, ...bill } = prepared.bill;
  const { stockAdds, items } = withNewVariantIds(prepared);
  const args = {
    // A fresh key per create: this process saves once and does not retry.
    p_key: crypto.randomUUID(),
    p_op: prepared.bill.paymentstatus === BILL_STATUS.PARTIAL ? "partial_create" : "finalize_create",
    p_payload: {
      bill,
      items,
      skip_stock: !stockReduced,
      // bill_save writes these as bill_salespersons rows, as for the screen's selector.
      ...(prepared.salespersons.length ? { salesperson_ids: prepared.salespersons.map((s) => s.salesperson_id) } : {}),
      ...(prepared.first_payment ? { first_payment: prepared.first_payment } : {}),
      // The exchange credit the bill spends, linked by bill_save, and any left over put on store
      // credit (finalize only), as the screen sends them.
      ...(exchangeIds.length ? { exchange_ids: exchangeIds } : {}),
      ...(prepared.exchange?.balance_to === "store_credit"
        ? { exchange_balance_to_credit: prepared.exchange.balance }
        : {}),
    },
  };
  // With stock adds, they and the bill are one transaction: the database adds the stock (or
  // creates the variant), then runs bill_save, and any error rolls back both.
  const { data: saved, error: saveErr } = stockAdds.length
    ? await client.rpc("bill_save_with_stock_adds", {
        ...args,
        p_stock_adds: stockAdds.map((a) => ({
          variantid: a.variantid, productid: a.productid, size: a.size, color: a.color, qty: a.qty, create: a.created,
        })),
      })
    : await client.rpc("bill_save", args);
  if (saveErr) {
    throw new Error("Failed to save bill: " + saveErr.message + (saveErr.details ? ` (${saveErr.details})` : ""));
  }
  const partial = prepared.bill.paymentstatus === BILL_STATUS.PARTIAL;

  for (const a of stockAdds) {
    await logActivityWith(client, {
      action: a.created ? "create" : "update",
      entityType: a.created ? "variant" : "stock",
      entityId: a.productid,
      summary: stockAddSummary(a, source),
    });
  }

  await logActivityWith(client, {
    action: "create",
    entityType: "bill",
    entityId: saved.bill_number || saved.billid,
    summary: `Finalized bill ${partial ? "(partial) " : ""}#${saved.bill_number || "(no number)"} for ${customerName(prepared.customer)} — ${money(prepared.totals.grand_total)}, ${prepared.bill_items.length} items (${source})`,
  });

  return {
    billid: saved.billid,
    bill_number: saved.bill_number,
    status: prepared.status,
    customer: prepared.customer,
    salespersons: prepared.salespersons,
    totals: prepared.totals,
    stock: prepared.stock,
    negative_stock: saved.negative_stock ?? [],
    warnings: prepared.warnings,
    ...(stockAdds.length && { stock_adds: stockAdds }),
    ...(prepared.exchange && {
      exchange: {
        source_bill: prepared.exchange.source_bill,
        exchange_ids: exchangeIds,
        credit: prepared.exchange.credit,
        credit_used: prepared.exchange.credit_used,
        balance: prepared.exchange.balance,
        balance_to: prepared.exchange.balance_to,
        returned: prepared.exchange.returned,
      },
    }),
  };
}

// Saves a new draft as the screen's Save Draft does (BillingForm.handleSaveDraft), since bill_save
// has no op for one: insert the bills row (its trigger assigns the bill number, as for any bill),
// then its items (on failure the row is deleted again, as the screen does; the database lets a
// draft be deleted), then its salespersons, then each variant's stock through stock_adjust
// (reason bill_draft_create), unless skip_stock. These are separate writes, as on the screen: a
// salespersons or stock failure keeps the draft and is listed in save_errors to fix by hand.
async function insertDraft(client, prepared, source) {
  const { data: bill, error: billErr } = await client
    .from("bills")
    .insert(prepared.bill)
    .select("billid, bill_number")
    .single();
  if (billErr) throw new Error("Failed to save bill: " + billErr.message);

  const { error: itemsErr } = await client
    .from("bill_items")
    .insert(prepared.bill_items.map((it) => ({ ...it, billid: bill.billid })));
  if (itemsErr) {
    const { error: delErr } = await client.from("bills").delete().eq("billid", bill.billid);
    throw new Error(
      "Failed to save bill items: " + itemsErr.message +
        (delErr ? ` — and draft ${bill.bill_number} (billid ${bill.billid}) could not be removed: ${delErr.message}` : ""),
    );
  }

  const save_errors = [];
  if (prepared.salespersons.length) {
    const { error: spErr } = await client
      .from("bill_salespersons")
      .insert(prepared.salespersons.map((s) => ({ billid: bill.billid, salesperson_id: s.salesperson_id })));
    if (spErr) save_errors.push(`Salespersons not saved (${spErr.message}); add them on the Billing screen`);
  }

  const negative_stock = [];
  if (prepared.bill.stock_reduced) {
    // Each change is atomic and independent, so they run together, as on the screen.
    await Promise.all(
      prepared.stock.map(async (s) => {
        const { data: after, error } = await client.rpc("stock_adjust", {
          p_variant: s.variantid,
          p_delta: s.change,
          p_reason: "bill_draft_create",
          p_ref: String(bill.billid),
        });
        if (error) save_errors.push(`Stock not reduced for ${s.productid} ${s.color}/${s.size} (${error.message}); recheck it`);
        else if (Number(after) < 0) negative_stock.push({ variantid: s.variantid, stock: Number(after) });
      }),
    );
  }

  const who = prepared.customer ? customerName(prepared.customer) : "walk-in";
  await logActivityWith(client, {
    action: "create",
    entityType: "bill",
    entityId: bill.bill_number || bill.billid,
    summary: `Created draft bill #${bill.bill_number || "(no number)"} for ${who} — ${money(prepared.totals.grand_total)}, ${prepared.bill_items.length} items (${source})`,
  });

  return {
    billid: bill.billid,
    bill_number: bill.bill_number,
    status: prepared.status,
    customer: prepared.customer,
    salespersons: prepared.salespersons,
    totals: prepared.totals,
    stock: prepared.stock,
    negative_stock,
    warnings: prepared.warnings,
    ...(save_errors.length && { save_errors }),
  };
}

/** A bill with its items, payments, customer, salespersons, slip photos and each variant's current stock. */
export async function getBill(client, { billid, billNumber }) {
  if (billid == null && !billNumber) throw new BillInputError("Give a bill id or bill number");
  let q = client.from("bills").select("*");
  q = billid != null ? q.eq("billid", Number(billid)) : q.eq("bill_number", String(billNumber).trim().toUpperCase());
  const bill = await one(q.maybeSingle());
  if (!bill) return null;

  const [items, payments, salespersons, customer, method, location, slipPhotos] = await Promise.all([
    one(client.from("bill_items").select("*").eq("billid", bill.billid).order("bill_item_id")),
    one(client.from("bill_payments").select("*").eq("billid", bill.billid).order("payment_id")),
    one(client.from("bill_salespersons").select("salesperson_id, salespersons(name)").eq("billid", bill.billid)),
    bill.customerid != null
      ? one(client.from("customers").select("customerid, first_name, last_name, phone").eq("customerid", bill.customerid).maybeSingle())
      : null,
    bill.salesmethodid != null
      ? one(client.from("salesmethods").select("methodname").eq("salesmethodid", bill.salesmethodid).maybeSingle())
      : null,
    bill.saleslocationid != null
      ? one(client.from("saleslocations").select("locationname").eq("saleslocationid", bill.saleslocationid).maybeSingle())
      : null,
    listSlipPhotos(client, bill.billid),
  ]);
  const variantIds = [...new Set((items ?? []).map((i) => i.variantid).filter(Boolean))];
  const variants = variantIds.length
    ? await one(client.from("productsizecolors").select("variantid, size, color, stock").in("variantid", variantIds))
    : [];
  const variantById = Object.fromEntries((variants ?? []).map((v) => [v.variantid, v]));

  return {
    ...bill,
    // A draft is not a sale yet: it has no PDF and is finished on the Billing screen.
    is_draft: isDraft(bill),
    payment_method: method?.methodname ?? null,
    location: location?.locationname ?? null,
    customer,
    salespersons: (salespersons ?? []).map((s) => ({ salesperson_id: s.salesperson_id, name: s.salespersons?.name ?? null })),
    items: (items ?? []).map((i) => {
      const v = i.variantid ? variantById[i.variantid] : null;
      return v ? { ...i, size: v.size, color: v.color, current_stock: Number(v.stock) } : i;
    }),
    payments: payments ?? [],
    slip_photos: slipPhotos,
  };
}

// Money that matches to the paisa, and a line's amount, checked to the rupee: lines land on or a
// few paise above the slip's amount before the balance discount is spread over them.
const PAISA = 0.01;
const LINE_TOLERANCE = 1;

/**
 * Compares a saved bill (getBill) with the spec it was made from: customer, date, status, each
 * line's item, qty, amount and alteration, the total, amount paid, payment method and
 * salespersons. For `slip finish`, so a bill that is not what the slip says is caught at once.
 * Returns { ok, mismatches, saved }: saved is a compact view of the bill as stored.
 */
export function checkBillAgainstSpec(rawSpec, bill) {
  const spec = parseBillSpec(rawSpec);
  const mismatches = [];
  const differs = (what, want, got) => mismatches.push(`${what}: spec ${JSON.stringify(want)}, bill ${JSON.stringify(got)}`);
  const eqi = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  const near = (a, b, tolerance) => Math.abs(Number(a) - Number(b)) <= tolerance + 1e-9;

  const c = spec.customer;
  const cust = bill.customer;
  if (c.kind === "id" && bill.customerid !== c.customerid) differs("customer", c.customerid, bill.customerid);
  if (c.kind === "phone" && cust?.phone !== normalizePhone(c.phone)) differs("customer phone", normalizePhone(c.phone), cust?.phone ?? null);
  if (c.kind === "new") {
    const want = customerName({ first_name: c.create.first, last_name: c.create.last });
    if (!cust || !eqi(customerName(cust), want)) differs("customer", want, cust ? customerName(cust) : null);
  }
  if (c.kind === "none" && bill.customerid != null) differs("customer", null, bill.customerid);

  const date = todayIST(new Date(bill.orderdate));
  if (date !== spec.date) differs("date", spec.date, date);
  const status = spec.draft ? BILL_STATUS.DRAFT : spec.payment.balance_due > 0 ? BILL_STATUS.PARTIAL : BILL_STATUS.FINALIZED;
  if (bill.paymentstatus !== status) differs("status", status, bill.paymentstatus);

  const lines = bill.items ?? [];
  if (lines.length !== spec.items.length) differs("lines", spec.items.length, lines.length);
  const paired = spec.items.map((it, i) => [it, lines[i]]).filter(([, line]) => line);
  // Line totals the spec asks for (goods + alteration) against the bill's. A finalized bill's are
  // lower by the balance discount that trims them to the amount agreed, spread over the lines in
  // proportion, so each is compared after its share. A draft has no balance discount.
  // Exchange credit pays for part of the bill, on top of what the customer pays.
  const exchangeCredit = Number(bill.exchange_credit_used ?? 0);
  const agreed = round2((spec.payment.amount ?? 0) + spec.payment.balance_due + exchangeCredit);
  const split = spec.sold_total == null
    ? null
    : splitByMrpShare(spec.sold_total, paired.map(([it, line]) => round2(Number(line.mrp) * it.qty)));
  const wantTotal = (it, line, i) => (split?.[i] ?? it.amount ?? round2(Number(line.mrp) * it.qty)) + it.alteration_charge;
  const sumWant = paired.reduce((s, [it, line], i) => s + wantTotal(it, line, i), 0);
  const gap = spec.draft ? 0 : Math.max(0, sumWant - agreed);
  for (const [i, [it, line]] of paired.entries()) {
    const at = `items[${i}]`;
    const { ref } = it;
    if (ref.kind === "product") {
      if (line.product_code !== ref.code) differs(`${at} product`, ref.code, line.product_code);
      if (ref.color != null && !eqi(line.color, ref.color)) differs(`${at} color`, ref.color, line.color ?? null);
      if (ref.size != null && !eqi(line.size, ref.size)) differs(`${at} size`, ref.size, line.size ?? null);
    } else if (ref.kind === "variant") {
      if (line.variantid !== ref.variantid) differs(`${at} variantid`, ref.variantid, line.variantid);
    } else if (ref.kind === "manual") {
      if (line.product_code !== ref.id) differs(`${at} manual item`, ref.id, line.product_code);
    } else if (!eqi(line.product_name, ref.create.name)) {
      differs(`${at} manual item`, ref.create.name, line.product_name);
    }
    if (Number(line.quantity) !== it.qty) differs(`${at} qty`, it.qty, Number(line.quantity));
    const alteration = Number(line.alteration_charge ?? 0);
    if (!near(alteration, it.alteration_charge, PAISA)) differs(`${at} alteration_charge`, it.alteration_charge, alteration);
    const want = wantTotal(it, line, i);
    const share = sumWant > 0 ? gap * (want / sumWant) : 0;
    if (!near(Number(line.total), want - share, LINE_TOLERANCE)) {
      differs(`${at} amount`, want - it.alteration_charge, round2(Number(line.total) - alteration));
    }
  }

  // A draft keeps its line totals as they stand; finishing it trims the total to what is paid.
  if (!spec.draft && !near(bill.totalamount, agreed, PAISA)) differs("total", agreed, Number(bill.totalamount));
  const paid = bill.payment_amount == null ? null : Number(bill.payment_amount);
  const paidMatches = paid == null || spec.payment.amount == null ? paid === spec.payment.amount : near(paid, spec.payment.amount, PAISA);
  if (!paidMatches) differs("paid", spec.payment.amount, paid);
  if (!eqi(bill.payment_method, spec.payment.method)) differs("method", spec.payment.method || null, bill.payment_method ?? null);
  if (spec.exchange && !(exchangeCredit > 0)) differs("exchange credit", "> 0", exchangeCredit);
  if (!spec.exchange && exchangeCredit > 0) differs("exchange credit", 0, exchangeCredit);
  if (spec.exchange?.kind === "return" && bill.exchange_source_bill !== spec.exchange.bill) {
    differs("exchange bill", spec.exchange.bill, bill.exchange_source_bill ?? null);
  }

  const onBill = bill.salespersons ?? [];
  const matches = (ref, s) => (typeof ref === "number" || /^\d+$/.test(ref) ? s.salesperson_id === Number(ref) : eqi(s.name, ref));
  const sameSalespersons =
    spec.salespersons.every((ref) => onBill.some((s) => matches(ref, s))) &&
    onBill.every((s) => spec.salespersons.some((ref) => matches(ref, s)));
  if (!sameSalespersons) differs("salespersons", spec.salespersons, onBill.map((s) => s.name));

  return {
    ok: mismatches.length === 0,
    mismatches,
    saved: {
      bill_number: bill.bill_number,
      status: bill.paymentstatus,
      customer: cust ? { customerid: cust.customerid, name: customerName(cust), phone: cust.phone ?? null } : null,
      date,
      lines: lines.map((l) => {
        const alteration = Number(l.alteration_charge ?? 0);
        return {
          code: l.product_code,
          ...(l.color != null && { color: l.color }),
          ...(l.size != null && { size: l.size }),
          qty: Number(l.quantity),
          amount: round2(Number(l.total) - alteration),
          ...(alteration && { alteration_charge: alteration }),
        };
      }),
      total: Number(bill.totalamount),
      ...(exchangeCredit > 0 && { exchange_credit: exchangeCredit, exchange_bill: bill.exchange_source_bill ?? null }),
      paid,
      method: bill.payment_method ?? null,
      salespersons: onBill.map((s) => s.name),
    },
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
