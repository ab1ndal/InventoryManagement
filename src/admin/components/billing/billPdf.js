// Everything a finalized bill's PDF needs, read back from what was stored.
import { supabase } from "../../../lib/supabaseClient";
import { rehydrateBillTotals } from "./rehydrateBill";
import { backCalcDiscountPct } from "./stockHelpers";

const BUCKET = "invoices";

/** Older rows hold a full public URL in pdf_url; newer ones hold the storage path. */
function pdfPath(pdfUrl) {
  if (!pdfUrl) return "";
  return pdfUrl.includes("/invoices/")
    ? decodeURIComponent(pdfUrl.split("/invoices/")[1]?.split("?")[0] || "")
    : pdfUrl;
}

/**
 * An online bill names who the order is for, from checkout. The linked account can be
 * someone else: whoever was signed in on that browser, and its name may only be an email
 * prefix (resolve_my_customer), so it must not be printed in place of the checkout name.
 */
export function billDisplayData(customer, order) {
  if (order) return { customerName: order.contact_name, isOnlineOrder: true };
  if (!customer) return { customerName: "", isOnlineOrder: false };
  return { customerName: `${customer.first_name} ${customer.last_name || ""}`.trim(), isOnlineOrder: false };
}

/**
 * Bills list row: an online bill shows and contacts the person the order is for, not the
 * linked account (see billDisplayData), on every screen that reads `customers`.
 */
export function withOrderContact(bill) {
  const order = bill.orders?.[0];
  if (!order) return bill;
  return {
    ...bill,
    customers: { first_name: order.contact_name, last_name: null },
    contact_phone: order.contact_phone,
  };
}

/** Versioned name so each save gets a guaranteed-fresh URL (no CDN or browser cache). */
export function savePdfPaths({ billId, billNumber, previousPdfUrl, now }) {
  const label = billNumber || billId;
  const oldPaths = [`bill-${label}.pdf`, `bill-${billId}.pdf`];
  const stored = pdfPath(previousPdfUrl);
  if (stored && !oldPaths.includes(stored)) oldPaths.push(stored);
  return { newPath: `bill-${label}-v${now}.pdf`, oldPaths };
}

export async function loadBillPdfData(billId) {
  const { data: billRow, error: billErr } = await supabase
    .from("bills")
    .select("applied_codes, payment_amount, net_amount, paymentstatus, saleslocationid, salesmethodid, store_credit_used, exchange_credit_used, exchange_source_bill, orderdate, customerid, bill_number, document_type, totalamount, gst_total, discount_total, taxable_total, pdf_url")
    .eq("billid", billId)
    .single();
  if (billErr) throw billErr;

  // Stable order so the reprint lines up with what was printed originally
  const { data: billItems } = await supabase.from("bill_items").select("*").eq("billid", billId).order("bill_item_id");

  const inventoryItems = (billItems || []).filter((bi) => bi.variantid);
  let variantMap = {};
  if (inventoryItems.length > 0) {
    const { data: variants } = await supabase
      .from("productsizecolors").select("variantid, size, color")
      .in("variantid", inventoryItems.map((bi) => bi.variantid));
    variantMap = Object.fromEntries((variants || []).map((v) => [v.variantid, v]));
  }

  const manualItems = (billItems || []).filter((bi) => !bi.variantid && bi.product_code);
  let manualMap = {};
  if (manualItems.length > 0) {
    const { data: manuals } = await supabase
      .from("manual_items").select("manual_item_id, size, color")
      .in("manual_item_id", manualItems.map((bi) => bi.product_code));
    manualMap = Object.fromEntries((manuals || []).map((m) => [m.manual_item_id, m]));
  }

  const items = (billItems || []).map((bi) => ({
    _id: String(bi.bill_item_id),
    source: bi.variantid ? "inventory" : "manual",
    variantid: bi.variantid || null,
    productid: bi.product_code || null,
    product_name: bi.product_name || "",
    category: bi.category || null,
    quantity: bi.quantity,
    mrp: bi.mrp,
    alteration_charge: bi.alteration_charge || 0,
    quickDiscountPct: backCalcDiscountPct(bi.discount_total, bi.mrp, bi.quantity),
    gstRate: bi.gst_rate ?? 18,
    stitchType: bi.stitch_type || "unstitched",
    size: variantMap[bi.variantid]?.size || manualMap[bi.product_code]?.size || null,
    color: variantMap[bi.variantid]?.color || manualMap[bi.product_code]?.color || null,
  }));

  const appliedCodes = billRow.applied_codes || [];
  let allDiscounts = [];
  if (appliedCodes.length > 0) {
    const { data: discData } = await supabase
      .from("discounts").select("id, code, type, value, max_discount, category, exclusive, auto_apply, min_total, start_date, end_date, active, rules")
      .in("code", appliedCodes);
    allDiscounts = discData || [];
  }

  let customer = null;
  if (billRow.customerid) {
    const { data: cust } = await supabase
      .from("customers").select("first_name, last_name").eq("customerid", billRow.customerid).single();
    customer = cust;
  }
  const { data: order, error: orderErr } = await supabase
    .from("orders").select("contact_name").eq("bill_id", billId).maybeSingle();
  if (orderErr) throw orderErr;

  const { data: spData } = await supabase
    .from("bill_salespersons").select("salesperson_id").eq("billid", billId);
  let salespersonNames = [];
  if (spData?.length) {
    const { data: spNames } = await supabase
      .from("salespersons").select("name").in("salesperson_id", spData.map((r) => r.salesperson_id));
    salespersonNames = (spNames || []).map((r) => r.name);
  }

  let paymentMethod = "";
  if (billRow.salesmethodid) {
    const { data: meth } = await supabase
      .from("salesmethods").select("methodname").eq("salesmethodid", billRow.salesmethodid).single();
    paymentMethod = meth?.methodname || "";
  }

  let appliedVoucher = null;
  const { data: voucherRow } = await supabase
    .from("vouchers").select("voucher_id, value").eq("redeemed_billid", billId).maybeSingle();
  if (voucherRow) appliedVoucher = { voucher_id: voucherRow.voucher_id, value: Number(voucherRow.value ?? 0) };

  // Payment history (needed for partial bill PDF)
  let billPayments = [];
  const { data: paymentsData } = await supabase
    .from("bill_payments")
    .select("payment_id, amount, kind, salesmethodid, recorded_at, salesmethods(methodname)")
    .eq("billid", billId)
    .order("recorded_at", { ascending: true });
  if (paymentsData) billPayments = paymentsData;

  const exchangeCredit = billRow.exchange_credit_used > 0
    ? { amount: Number(billRow.exchange_credit_used), sourceBillNumber: billRow.exchange_source_bill }
    : null;

  // A reprint must reproduce what the customer was charged, so read the stored
  // numbers rather than re-pricing the items (see rehydrateBill.js).
  const { computed, lines, discountLines } = rehydrateBillTotals(billRow, billItems || [], allDiscounts, items);

  return {
    previousPdfUrl: billRow.pdf_url,
    view: {
      lines,
      discountLines,
      billId,
      billNumber: billRow.bill_number || null,
      billDate: new Date(billRow.orderdate),
      ...billDisplayData(customer, order),
      salespersonNames,
      items,
      computed,
      paymentMethod,
      paymentAmount: billRow.payment_amount ?? 0,
      appliedCodes,
      allDiscounts,
      appliedVoucher,
      appliedStoreCredit: Number(billRow.store_credit_used ?? 0),
      exchangeCredit,
      billPayments,
      paymentStatus: billRow.paymentstatus || "finalized",
      docType: billRow.document_type || "bos",
    },
  };
}

/**
 * Uploads, points the bill at the new file, then clears older files, so a failure at any
 * step leaves the bill on a PDF that still exists. Returns the new path.
 */
export async function saveBillPdf({ billId, billNumber, previousPdfUrl, blob }) {
  const { newPath, oldPaths } = savePdfPaths({ billId, billNumber, previousPdfUrl, now: Date.now() });
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET).upload(newPath, blob, { contentType: "application/pdf" });
  if (uploadErr) throw uploadErr;
  const { error: updateErr } = await supabase.from("bills").update({ pdf_url: newPath }).eq("billid", billId);
  if (updateErr) throw updateErr;
  const { error: removeErr } = await supabase.storage.from(BUCKET).remove(oldPaths);
  // The bill already has its new PDF; a leftover old file costs only storage.
  if (removeErr) console.warn("old bill PDFs not removed", { billId, oldPaths, message: removeErr.message });
  return newPath;
}

export async function openBillPdf(pdfUrl) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(pdfPath(pdfUrl), 3600);
  if (error) throw error;
  window.open(data.signedUrl, "_blank");
}
