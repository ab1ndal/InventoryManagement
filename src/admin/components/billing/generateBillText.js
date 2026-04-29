const STORE = {
  name: "BINDAL'S CREATION",
  tagline: "A Complete Range of Family Wear",
  address: "58 Sihani Gate Market, Ghaziabad 201001",
  phone: "+91 9810873280 | +91 9810121438",
  gstin: "09ABVPB4203A1Z4",
};

function fmt(n) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Generates a professional WhatsApp-ready bill summary.
 *
 * @param {object} opts
 * @param {string} opts.billNumber
 * @param {string|Date} opts.billDate
 * @param {string} opts.customerName
 * @param {Array} opts.items  - same shape used by InvoiceView / BillingForm
 * @param {object} opts.computed - output of computeBillTotals()
 * @param {string} opts.paymentMethod
 * @param {number} opts.paymentAmount
 * @param {number} [opts.appliedStoreCredit]
 * @returns {string}
 */
export function generateBillText({
  billNumber,
  billDate,
  customerName,
  items = [],
  computed = {},
  paymentMethod,
  appliedStoreCredit = 0,
}) {
  const date = billDate ? fmtDate(billDate) : "";
  const storeCreditAmt = Math.min(
    Number(appliedStoreCredit || 0),
    Number(computed.grandTotal || 0),
  );
  const netPayable = Math.max(0, Number(computed.grandTotal || 0) - storeCreditAmt);

  const itemLines = items.map((item, i) => {
    const mrp = Number(item.mrp) || 0;
    const qty = Number(item.qty || item.quantity) || 0;
    const discPct = Number(item.quickDiscountPct) || 0;
    const disc = mrp * qty * (discPct / 100);
    const alteration = Number(item.alteration_charge || item.stitching_charge || 0);
    const lineTotal = mrp * qty - disc + alteration;

    const variant = [item.size, item.color].filter(Boolean).join("|");
    const name = item.product_name || "—";
    const variantStr = variant ? ` (${variant})` : "";
    const alterStr = alteration > 0 ? ` +Alt ${fmt(alteration)}` : "";
    const qtyStr = item.unit_type === "meter" ? `${qty}m @ ${fmt(mrp)}/m` : `× ${qty}`;
    return `${i + 1}. ${name}${variantStr} ${qtyStr} = ${fmt(lineTotal)}${alterStr}`;
  });

  const parts = [
    `*${STORE.name}*`,
    `_${STORE.tagline}_`,
    STORE.address,
    `Ph: ${STORE.phone}`,
    `GSTIN: ${STORE.gstin}`,
    "",
    `*Bill No: ${billNumber || "—"}*  |  Date: ${date}`,
    customerName ? `Customer: ${customerName}` : null,
    "",
    "*ITEMS*",
    ...itemLines,
    "",
    `Subtotal (MRP):     ${fmt(computed.itemsSubtotal)}`,
    Number(computed.itemLevelDiscountTotal) > 0
      ? `Item Discounts:    -${fmt(computed.itemLevelDiscountTotal)}`
      : null,
    Number(computed.overallDiscount) > 0
      ? `Code Discounts:    -${fmt(computed.overallDiscount)}`
      : null,
    Number(computed.balanceDiscount) > 0
      ? `Extra Discount:    -${fmt(computed.balanceDiscount)}`
      : null,
    `GST:               +${fmt(computed.gstTotal)}`,
    `*Grand Total:       ${fmt(computed.grandTotal)}*`,
    storeCreditAmt > 0 ? `Store Credit:      -${fmt(storeCreditAmt)}` : null,
    storeCreditAmt > 0 ? `*Net Payable:       ${fmt(netPayable)}*` : null,
    paymentMethod ? `Payment:           ${paymentMethod}` : null,
    "",
    Number(computed.itemLevelDiscountTotal || 0) +
      Number(computed.overallDiscount || 0) +
      Number(computed.balanceDiscount || 0) >
    0
      ? `✨ You saved ${fmt(
          Number(computed.itemLevelDiscountTotal || 0) +
            Number(computed.overallDiscount || 0) +
            Number(computed.balanceDiscount || 0),
        )} today!`
      : null,
    "",
    "_Exchange within 7 days with original bill (after 12 PM)._",
    "_Items must be unused, unwashed & in original condition._",
    "",
    "Thank you for shopping with us! 🙏",
  ];

  return parts.filter((l) => l !== null).join("\n");
}
