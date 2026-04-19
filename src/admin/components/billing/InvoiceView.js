import React, { forwardRef } from "react";
import logo from "../../../assets/LOGO-Bill.png";
import { getFreeItems, valueOfDiscount } from './billUtils';

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
  },
  ref,
) {
  // Compute per-line GST breakdown
  const lineItems = (items || []).map((item, idx) => {
    const mrp = Number(item.mrp) || 0;
    const qty = Number(item.qty || item.quantity) || 0;
    const gstRate = Number(item.gstRate) || 0;
    const disc = mrp * qty * ((Number(item.quickDiscountPct) || 0) / 100);
    const alteration = Number(
      item.alteration_charge || item.stitching_charge || 0,
    );
    const afterDisc = mrp * qty - disc;
    const withCharges = afterDisc + alteration;
    const lineGross =
      gstRate > 0 ? withCharges * (1 + gstRate / 100) : withCharges;
    const taxable = withCharges;
    const cgst = (taxable * (gstRate / 2)) / 100;
    const sgst = (taxable * (gstRate / 2)) / 100;
    return {
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

  // Per-discount breakdown — filter to codes that actually yielded a non-zero amount
  // gst_off codes handled separately below
  const gstOffCodes = (appliedCodes || []).filter((code) => {
    const d = (allDiscounts || []).find((d) => d.code === code);
    return d?.type === "gst_off";
  });

  const appliedDiscountDetails = (appliedCodes || [])
    .filter((code) => !gstOffCodes.includes(code))
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

  const gstOffSavings = Number(computed?.gstOffSavings ?? 0);
  const hasGstOff = gstOffCodes.length > 0 && gstOffSavings > 0;

  // Voucher / store-credit / net payable
  const grandTotal = Number(computed?.grandTotal ?? 0);
  const voucherAmt = Math.min(Number(appliedVoucher?.value ?? 0), grandTotal);
  const postVoucher = Math.max(0, grandTotal - voucherAmt);
  const storeCreditAmt = Math.min(Number(appliedStoreCredit ?? 0), postVoucher);
  const effectiveTotal = Math.max(0, postVoucher - storeCreditAmt);

  const paidAmt = Number(paymentAmount ?? 0);
  const shortfall = effectiveTotal - paidAmt;
  const additionalDiscount =
    paidAmt > 0 && shortfall > 0 && shortfall <= 100 ? shortfall : 0;
  const finalAmountDue = effectiveTotal - additionalDiscount;

  // Total savings = original full price (MRP+GST+alterations) minus what was actually paid
  const itemsSubtotal = Number(computed?.itemsSubtotal ?? 0);
  const originalFullPrice = lineItems.reduce((s, l) => s + l.lineGross, 0);
  const totalSaved =
    originalFullPrice > 0 ? originalFullPrice - finalAmountDue : 0;
  const savingsPct =
    originalFullPrice > 0 ? (totalSaved / originalFullPrice) * 100 : 0;

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
            <th style={thRight}>GST%</th>
            <th style={thRight}>Taxable (₹)</th>
            <th style={thRight}>CGST (₹)</th>
            <th style={thRight}>SGST (₹)</th>
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
                    {alteration > 0 && (
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        Alt: ₹{alteration.toFixed(2)}
                      </div>
                    )}
                  </td>
                  <td style={tdRight}>{qty}</td>
                  <td style={tdRight}>
                    ₹{mrp.toFixed(2)}
                    {alteration > 0 && (
                      <div style={{ color: "#6b7280", fontSize: "10px" }}>
                        +₹{alteration.toFixed(2)} Alt
                      </div>
                    )}
                  </td>
                  <td style={tdRight}>₹{disc.toFixed(2)}</td>
                  <td style={tdRight}>{gstRate}%</td>
                  <td style={tdRight}>₹{taxable.toFixed(2)}</td>
                  <td style={tdRight}>₹{cgst.toFixed(2)}</td>
                  <td style={tdRight}>₹{sgst.toFixed(2)}</td>
                  <td style={tdRight}>₹{lineGross.toFixed(2)}</td>
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
        {hasGstOff && (
          <div style={{ color: "#dc2626" }}>
            {gstOffCodes.join(", ")} (Special Discount): −₹{gstOffSavings.toFixed(2)}
          </div>
        )}
        {Number(computed?.balanceDiscount ?? 0) > 0 && (
          <div style={{ color: "#dc2626" }}>
            Balance Adjustment: −₹{Number(computed.balanceDiscount).toFixed(2)}
          </div>
        )}
        <div style={{ color: "#6b7280", fontSize: "10px", marginTop: 2 }}>
          {`CGST: ₹${totalCgst.toFixed(2)} | SGST: ₹${totalSgst.toFixed(2)}`}
        </div>
        <div style={{ fontSize: "14px", fontWeight: 600, marginTop: 4 }}>
          Grand Total: ₹{grandTotal.toFixed(2)}
        </div>
        {voucherAmt > 0 && (
          <div style={{ color: "#dc2626" }}>
            Voucher #{appliedVoucher.voucher_id}: −₹{voucherAmt.toFixed(2)}
          </div>
        )}
        {storeCreditAmt > 0 && (
          <div style={{ color: "#dc2626" }}>
            Store Credit: −₹{storeCreditAmt.toFixed(2)}
          </div>
        )}
        {(voucherAmt > 0 || storeCreditAmt > 0) && (
          <div style={{ fontWeight: 600 }}>
            Net Payable: ₹{effectiveTotal.toFixed(2)}
          </div>
        )}
        {additionalDiscount > 0 && (
          <div style={{ color: "#dc2626" }}>
            Additional Store Discount (
            {((additionalDiscount / effectiveTotal) * 100).toFixed(1)}% off): −₹
            {additionalDiscount.toFixed(2)}
          </div>
        )}
      </div>

      {/* 5. Payment Footer */}
      <div
        style={{
          borderTop: "1px solid #e5e7eb",
          paddingTop: "8px",
          marginBottom: "8px",
        }}
      >
        <div>
          <strong>Payment Method:</strong> {paymentMethod}
        </div>
        <div>
          <strong>Amount Received:</strong> ₹
          {(additionalDiscount > 0 ? finalAmountDue : paidAmt).toFixed(2)}
        </div>
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
