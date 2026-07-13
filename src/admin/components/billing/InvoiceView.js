import React, { forwardRef } from "react";
import logo from "../../../assets/LOGO-Bill.png";
import { getFreeItems, valueOfDiscount } from './billUtils';
import { computeCreditsApplied } from './exchangeHelpers';

const STORE = {
  name: "BINDAL'S CREATION",
  tagline: "A COMPLETE RANGE OF FAMILY WEAR",
  address: "58 Sihani Gate Market, Ghaziabad 201001",
  phone: "+91 9810873280 | +91 9810121438",
  gstin: "09ABVPB4203A1Z4",
};

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const InvoiceView = forwardRef(function InvoiceView(
  {
    billId,
    billNumber,
    billDate,
    customerName,
    salespersonNames,
    items,
    computed,
    paymentMethod,
    paymentAmount,
    appliedCodes,
    allDiscounts,
    appliedVoucher,
    appliedStoreCredit,
    exchangeCredit = null,
    exchangeCashRefund = 0,
    billPayments = [],
    paymentStatus = "finalized",
    docType = "invoice",
  },
  ref,
) {
  const isBos = docType === "bos";
  // Distribute overall + balance + voucher discounts proportionally (mirrors buildBillItemsPayload)
  const overallDiscount = Number(computed?.overallDiscount ?? 0);
  const balanceDiscount = Number(computed?.balanceDiscount ?? 0);
  const voucherPreTax = Number(
    computed?.voucherPreTax ?? appliedVoucher?.value ?? 0,
  );
  const totalWithCharges = (items || []).reduce((s, item) => {
    const mrp = Number(item.mrp) || 0;
    const qty = Number(item.qty || item.quantity) || 0;
    const disc = mrp * qty * ((Number(item.quickDiscountPct) || 0) / 100);
    const alteration = Number(
      item.alteration_charge || item.stitching_charge || 0,
    );
    return s + (mrp * qty - disc + alteration);
  }, 0);
  // clamp voucher to what's actually deductible pre-tax
  const effectiveVoucher = Math.min(
    voucherPreTax,
    Math.max(0, totalWithCharges - overallDiscount - balanceDiscount),
  );

  // Compute per-line GST breakdown
  const lineItems = (items || []).map((item, idx) => {
    const mrp = Number(item.mrp) || 0;
    const qty = Number(item.qty || item.quantity) || 0;
    const disc = mrp * qty * ((Number(item.quickDiscountPct) || 0) / 100);
    const alteration = Number(
      item.alteration_charge || item.stitching_charge || 0,
    );
    const withCharges = mrp * qty - disc + alteration;

    const proportion =
      totalWithCharges > 0
        ? withCharges / totalWithCharges
        : 1 / Math.max((items || []).length, 1);
    const itemOverallDisc =
      overallDiscount > 0 ? overallDiscount * proportion : 0;
    const itemBalanceDisc =
      balanceDiscount > 0 ? balanceDiscount * proportion : 0;
    const itemVoucherDisc =
      effectiveVoucher > 0 ? effectiveVoucher * proportion : 0;
    const adjustedTaxable = Math.max(
      0,
      withCharges - itemOverallDisc - itemBalanceDisc - itemVoucherDisc,
    );

    // Re-evaluate GST slab on adjusted per-piece price (mirrors computeBillTotals)
    let gstRate = Number(item.gstRate) || 0;
    const stitchType = item.stitchType || 'unstitched';
    if (stitchType === 'unstitched') {
      gstRate = 5;
    } else {
      const garmentTaxable = adjustedTaxable - alteration;
      const effectivePricePerUnit = qty > 0 ? garmentTaxable / qty : 0;
      if (effectivePricePerUnit > 0) {
        gstRate = effectivePricePerUnit <= 2500 ? 5 : 18;
      }
    }
    const garmentTaxable = adjustedTaxable - alteration;
    const cgst =
      (garmentTaxable * (gstRate / 2)) / 100 + (0.05 * alteration) / 1.05 / 2;
    const sgst =
      (garmentTaxable * (gstRate / 2)) / 100 + (0.05 * alteration) / 1.05 / 2;
    const lineGross = garmentTaxable + cgst + sgst + alteration / 1.05;
    return {
      item,
      idx,
      mrp,
      qty,
      gstRate,
      disc: disc + itemOverallDisc + itemBalanceDisc + itemVoucherDisc,
      alteration,
      lineGross,
      taxable: garmentTaxable + alteration / 1.05,
      cgst,
      sgst,
      bosAmount: adjustedTaxable, // value + full alteration, no GST
    };
  });

  // Identify items that are free via buy_x_get_y discounts (D-10)
  const freeItemIndices = new Set();
  if (appliedCodes && allDiscounts) {
    appliedCodes.forEach((code) => {
      const d = allDiscounts.find(
        (disc) => disc.code === code && disc.type === "buy_x_get_y",
      );
      if (d) {
        const freeItems = getFreeItems(d, items);
        freeItems.forEach((f) => freeItemIndices.add(f.itemIndex));
      }
    });
  }

  const totalCgst = lineItems.reduce((s, l) => s + l.cgst, 0);
  const totalSgst = lineItems.reduce((s, l) => s + l.sgst, 0);

  // preOverallTaxable = bill total after item discounts, before overall discount codes
  // Use this as the denominator for per-code discount % (the "pre-discount bill amount")
  const preOverallTaxable = Number(
    computed?.preOverallTaxable ?? computed?.itemsSubtotal ?? 0,
  );

  // Per-discount breakdown — all codes including gst_off (now pre-tax)
  const appliedDiscountDetails = (appliedCodes || [])
    .map((code) => {
      const d = (allDiscounts || []).find((disc) => disc.code === code);
      if (!d) return null;
      const amount = valueOfDiscount(d, items || []);
      if (amount <= 0) return null;
      const base = preOverallTaxable > 0 ? preOverallTaxable : 1;
      const pct = ((amount / base) * 100).toFixed(1);
      return { code, amount, pct };
    })
    .filter(Boolean);

  // voucher is pre-tax (in grandTotal); store/exchange credits are customer payments
  const grandTotal = Number(computed?.grandTotal ?? 0);
  const {
    storeCreditUsed: storeCreditAmt,
    exchangeCreditUsed: exchangeCreditAmt,
    effectiveTotal,
  } = computeCreditsApplied(grandTotal, appliedStoreCredit, exchangeCredit?.amount);

  const paidAmt = Number(paymentAmount ?? 0);
  const shortfall = effectiveTotal - paidAmt;
  const additionalDiscount =
    paidAmt > 0 && shortfall > 0 && shortfall <= 100 ? shortfall : 0;
  const finalAmountDue = effectiveTotal - additionalDiscount;

  // Total savings = item discounts + code discounts + balance discount + voucher + additional store discount
  const itemsSubtotal = Number(computed?.itemsSubtotal ?? 0);
  const totalSaved =
    itemsSubtotal > 0
      ? Number(computed?.itemLevelDiscountTotal ?? 0) +
        Number(computed?.overallDiscount ?? 0) +
        Number(computed?.balanceDiscount ?? 0) +
        effectiveVoucher +
        additionalDiscount
      : 0;
  const savingsPct = itemsSubtotal > 0 ? (totalSaved / itemsSubtotal) * 100 : 0;

  const thStyle = {
    padding: "6px 4px",
    borderBottom: "1px solid #e5e7eb",
    fontWeight: 600,
  };
  const thLeft = { ...thStyle, textAlign: "left" };
  const thRight = { ...thStyle, textAlign: "right" };
  const tdLeft = {
    padding: "4px",
    textAlign: "left",
    borderBottom: "1px solid #f3f4f6",
  };
  const tdRight = {
    padding: "4px",
    textAlign: "right",
    borderBottom: "1px solid #f3f4f6",
  };

  return (
    <div
      ref={ref}
      style={{
        width: "794px",
        backgroundColor: "#ffffff",
        padding: "24px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#111827",
        fontSize: "11px",
        lineHeight: 1.4,
      }}
    >
      {/* 1. Store Header */}
      <div
        style={{
          position: "relative",
          textAlign: "center",
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: "12px",
          marginBottom: "12px",
        }}
      >
        <img
          src={logo}
          alt="Bindal's Creation"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: "auto",
            objectFit: "contain",
          }}
        />
        <div>
          <div
            style={{
              fontSize: "20px",
              fontWeight: 600,
              letterSpacing: "2px",
              textTransform: "uppercase",
            }}
          >
            {STORE.name}
          </div>
          <div style={{ fontSize: "11px", color: "#6b7280" }}>
            {STORE.tagline}
          </div>
          <div>{STORE.address}</div>
          <div>{STORE.phone}</div>
          <div>
            <span style={{ fontWeight: 600 }}>GSTIN:</span> {STORE.gstin}
          </div>
        </div>
      </div>

      {/* 2. Bill Metadata */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <div>
          <div>
            <strong>{isBos ? "Bill of Supply" : "Tax Invoice"}</strong>
          </div>
          <div>
            <strong>Bill No:</strong> {billNumber || billId}
          </div>
          <div>
            <strong>Date:</strong> {billDate ? formatDate(billDate) : "—"}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div>
            <strong>Customer:</strong> {customerName || "—"}
          </div>
          <div>
            <strong>Salesperson(s):</strong>{" "}
            {(salespersonNames || []).join(", ") || "—"}
          </div>
        </div>
      </div>

      {/* 3. Line Items Table */}
      <table
        style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}
      >
        <thead>
          <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 600 }}>
            <th style={thLeft}>S.No.</th>
            <th style={thLeft}>Particulars</th>
            <th style={thRight}>Qty</th>
            <th style={thRight}>Rate (₹)</th>
            <th style={thRight}>Disc (₹)</th>
            {!isBos && <th style={thRight}>GST%</th>}
            {!isBos && <th style={thRight}>Taxable (₹)</th>}
            {!isBos && <th style={thRight}>CGST (₹)</th>}
            {!isBos && <th style={thRight}>SGST (₹)</th>}
            <th style={thRight}>Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map(
            ({
              item,
              idx,
              mrp,
              qty,
              gstRate,
              disc,
              alteration,
              lineGross,
              taxable,
              cgst,
              sgst,
              bosAmount,
            }) => {
              const rowBg = idx % 2 === 0 ? "#ffffff" : "#fafafa";
              return (
                <tr key={item._id || idx} style={{ backgroundColor: rowBg }}>
                  <td style={tdLeft}>{idx + 1}</td>
                  <td style={tdLeft}>
                    <div>
                      {item.product_name || "—"}
                      {freeItemIndices.has(idx) && (
                        <span
                          style={{
                            display: "inline-block",
                            marginLeft: "6px",
                            padding: "1px 6px",
                            fontSize: "9px",
                            fontWeight: 700,
                            color: "#16a34a",
                            border: "1px solid #16a34a",
                            borderRadius: "3px",
                            verticalAlign: "middle",
                            letterSpacing: "0.5px",
                          }}
                        >
                          FREE
                        </span>
                      )}
                    </div>
                    {item.productid && (
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        {item.productid}
                      </div>
                    )}
                    {(item.size || item.color) && (
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        ({[item.size, item.color].filter(Boolean).join("|")})
                      </div>
                    )}
                  </td>
                  <td style={tdRight}>
                    {item.unit_type === "meter" ? `${qty}m` : qty}
                  </td>
                  <td style={tdRight}>
                    ₹{mrp.toFixed(2)}{item.unit_type === "meter" && <span style={{ color: "#6b7280", fontSize: "10px" }}>/m</span>}
                    {alteration > 0 && (
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        +₹{alteration.toFixed(2)} Alt
                      </div>
                    )}
                  </td>
                  <td style={tdRight}>₹{disc.toFixed(2)}</td>
                  {!isBos && <td style={tdRight}>{gstRate}%</td>}
                  {!isBos && <td style={tdRight}>₹{taxable.toFixed(2)}</td>}
                  {!isBos && <td style={tdRight}>₹{cgst.toFixed(2)}</td>}
                  {!isBos && <td style={tdRight}>₹{sgst.toFixed(2)}</td>}
                  <td style={tdRight}>₹{(isBos ? bosAmount : lineGross).toFixed(2)}</td>
                </tr>
              );
            },
          )}
        </tbody>
      </table>

      {/* 4. Totals Section */}
      <div style={{ textAlign: "right", marginBottom: "12px" }}>
        <div>Item Subtotal: ₹{itemsSubtotal.toFixed(2)}</div>
        {Number(computed?.itemLevelDiscountTotal ?? 0) > 0 && (
          <div style={{ color: "#dc2626" }}>
            Item Discounts: −₹
            {Number(computed.itemLevelDiscountTotal).toFixed(2)}
          </div>
        )}
        {appliedDiscountDetails.map(({ code, amount, pct }) => (
          <div key={code} style={{ color: "#dc2626" }}>
            {code} ({pct}% off): −₹{amount.toFixed(2)}
          </div>
        ))}
        {Number(computed?.balanceDiscount ?? 0) > 0 && (
          <div style={{ color: "#dc2626" }}>
            Additional Store Discount: −₹
            {Number(computed.balanceDiscount).toFixed(2)}
          </div>
        )}
        {!isBos && (
          <div style={{ color: "#6b7280", fontSize: "10px", marginTop: 2 }}>
            {`CGST: ₹${totalCgst.toFixed(2)} | SGST: ₹${totalSgst.toFixed(2)}`}
          </div>
        )}
        <div style={{ fontSize: "14px", fontWeight: 600, marginTop: 4 }}>
          Grand Total: ₹{grandTotal.toFixed(2)}
        </div>
        {storeCreditAmt > 0 && (
          <div style={{ color: "#16a34a" }}>
            Paid via Store Credit: −₹{storeCreditAmt.toFixed(2)}
          </div>
        )}
        {exchangeCreditAmt > 0 && (
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e5e7eb" }}>
            <div style={{ color: "#7c3aed", fontWeight: 600 }}>
              Exchange Credit — Bill #{exchangeCredit?.sourceBillNumber}: −₹{exchangeCreditAmt.toFixed(2)}
            </div>
            {exchangeCredit?.items?.length > 0 && (
              <div style={{ paddingLeft: 8, marginTop: 2, fontSize: "10px", color: "#6d28d9" }}>
                {exchangeCredit.items.map((it, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{it.product_name} × {it.returnQty}</span>
                    <span>−₹{Number(it.creditAmount).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {(storeCreditAmt > 0 || exchangeCreditAmt > 0) && (
          <div style={{ fontWeight: 600, marginTop: 4 }}>
            Net Payable: ₹{effectiveTotal.toFixed(2)}
          </div>
        )}
        {Number(exchangeCashRefund) > 0 && (
          <div style={{
            marginTop: 8,
            padding: "6px 10px",
            backgroundColor: "#fef3c7",
            border: "1px solid #f59e0b",
            borderRadius: "4px",
            color: "#92400e",
            fontWeight: 600,
          }}>
            Exchange Bill Refunded: ₹{Number(exchangeCashRefund).toFixed(2)} returned to customer
            {exchangeCredit?.sourceBillNumber ? ` (Ref: Bill #${exchangeCredit.sourceBillNumber})` : ""}
          </div>
        )}
        {additionalDiscount > 0 && (
          <div style={{ color: "#dc2626" }}>
            Bill Rounding: −₹{additionalDiscount.toFixed(2)}
          </div>
        )}
      </div>

      {/* Goods-withheld warning for partial bills */}
      {paymentStatus === "partial" && (
        <div
          style={{
            border: "2px solid #dc2626",
            borderRadius: "4px",
            padding: "8px 12px",
            margin: "8px 0",
            backgroundColor: "#fef2f2",
            color: "#dc2626",
            fontWeight: 700,
            textAlign: "center",
            fontSize: "12px",
            letterSpacing: "0.5px",
          }}
        >
          ⚠ GOODS WILL NOT BE RELEASED UNTIL PAYMENT IN FULL
        </div>
      )}

      {/* Payment history for multi-payment bills */}
      {billPayments.length > 0 && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: "1px solid #e5e7eb",
            marginBottom: 8,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: "11px" }}>
            Payment History
          </div>
          <table style={{ width: "100%", fontSize: "10px", borderCollapse: "collapse" }}>
            <tbody>
              {billPayments.map((p, i) => (
                <tr key={p.payment_id ?? i} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "2px 4px" }}>{formatDate(p.recorded_at)}</td>
                  <td style={{ padding: "2px 4px" }}>
                    {p.salesmethods?.methodname || p.methodname || "—"}
                  </td>
                  <td style={{ padding: "2px 4px", textAlign: "right" }}>
                    ₹{Number(p.amount).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(() => {
            const totalPaid = billPayments.reduce((s, p) => s + Number(p.amount), 0);
            const balanceDue = Math.max(0, effectiveTotal - totalPaid);
            return (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontWeight: 600,
                    marginTop: 4,
                    fontSize: "11px",
                  }}
                >
                  <span>Total Paid</span>
                  <span>₹{totalPaid.toFixed(2)}</span>
                </div>
                {balanceDue > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 700,
                      color: "#dc2626",
                      fontSize: "11px",
                    }}
                  >
                    <span>Balance Due</span>
                    <span>₹{balanceDue.toFixed(2)}</span>
                  </div>
                ) : (
                  <div style={{ color: "#16a34a", fontWeight: 600, fontSize: "11px" }}>
                    ✓ PAID IN FULL
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* 5. Payment Footer */}
      <div
        style={{
          borderTop: "1px solid #e5e7eb",
          paddingTop: "8px",
          marginBottom: "8px",
        }}
      >
        {billPayments.length === 0 ? (
          <>
            <div>
              <strong>Payment Method:</strong> {paymentMethod}
            </div>
            <div>
              <strong>Amount Received:</strong> ₹
              {(additionalDiscount > 0 ? finalAmountDue : paidAmt).toFixed(2)}
            </div>
          </>
        ) : (
          <div>
            <strong>Payment Status:</strong>{" "}
            {paymentStatus === "partial" ? "Partial — Balance Due" : "Paid in Full"}
          </div>
        )}
        {storeCreditAmt > 0 && (
          <div>
            <strong>Store Credit Used:</strong> ₹{storeCreditAmt.toFixed(2)}
          </div>
        )}
        {exchangeCreditAmt > 0 && (
          <div>
            <strong>Exchange Credit (Bill #{exchangeCredit?.sourceBillNumber}):</strong> ₹{exchangeCreditAmt.toFixed(2)}
          </div>
        )}
      </div>

      {/* Savings callout */}
      {totalSaved > 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "6px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "4px",
            marginBottom: "8px",
            color: "#15803d",
            fontWeight: 600,
          }}
        >
          You saved ₹{totalSaved.toFixed(2)} today ({savingsPct.toFixed(1)}% off
          MRP)!
        </div>
      )}

      {isBos && (
        <div
          style={{
            marginTop: "8px",
            padding: "6px 10px",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            fontSize: "10px",
            fontStyle: "italic",
            color: "#374151",
          }}
        >
          Composition taxable person, not eligible to collect tax on supplies.
        </div>
      )}

      {/* 6. Notes Footer */}
      <div
        style={{
          marginTop: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          fontSize: "11px",
        }}
      >
        <div style={{ color: "#6b7280", maxWidth: "60%" }}>
          <div style={{ fontWeight: 600, marginBottom: "2px" }}>
            Terms & Conditions:
          </div>
          <ul style={{ margin: 0, paddingLeft: "14px", lineHeight: 1.6 }}>
            <li>
              No returns. Exchange only within 7 days with original bill,
              accepted after 12 PM.
            </li>
            <li>
              Exchanged items must be unused, unwashed and in original
              condition.
            </li>
            <li>
              Exchange/store credit will be limited to the amount paid as per
              the bill.
            </li>
            <li>Color of products is not guaranteed.</li>
            <li>Any damage must be reported within 24 hours of purchase.</li>
          </ul>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ height: "60px" }} />
          <div
            style={{
              borderTop: "1px solid #111827",
              paddingTop: "4px",
              minWidth: "140px",
            }}
          >
            Auth Signature
          </div>
        </div>
      </div>
    </div>
  );
});

export default InvoiceView;
