// src/admin/components/billing/ReturnReceiptView.js
import React, { forwardRef } from "react";
import logo from "../../../assets/LOGO-Bill.png";
import { formatDate } from "../../../utility/dateFormat";
import { formatINR } from "../../../utility/formatCurrency";

const STORE = {
  name: "BINDAL'S CREATION",
  tagline: "A COMPLETE RANGE OF FAMILY WEAR",
  address: "58 Sihani Gate Market, Ghaziabad 201001",
  phone: "+91 9810873280 | +91 9810121438",
  gstin: "09ABVPB4203A1Z4",
};

const ReturnReceiptView = forwardRef(function ReturnReceiptView(
  { billId, originalBillDate, customerName, items, creditAmount, issueDate, mode = "cancel" },
  ref
) {
  return (
    <div
      ref={ref}
      style={{
        width: "559px",
        backgroundColor: "#ffffff",
        padding: "16px",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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
          paddingBottom: "8px",
          marginBottom: "8px",
        }}
      >
        <img src={logo} alt="Bindal's Creation" style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "auto", objectFit: "contain" }} />
        <div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            {STORE.name}
          </div>
          <div>{STORE.address}</div>
          <div>{STORE.phone}</div>
        </div>
      </div>

      {/* 2. Receipt Label */}
      <div
        style={{
          fontSize: "13px",
          fontWeight: 600,
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "2px",
          padding: "8px 0",
          borderBottom: "1px solid #e5e7eb",
          marginBottom: "8px",
        }}
      >
        {mode === "exchange" ? "EXCHANGE RECEIPT" : "STORE CREDIT RECEIPT"}
      </div>

      {/* 3. Bill Details Block */}
      <div style={{ fontSize: "11px", marginBottom: "2px" }}>
        <div style={{ marginBottom: "2px" }}>
          <strong>Bill #:</strong> {billId}
        </div>
        <div style={{ marginBottom: "2px" }}>
          <strong>Original Date:</strong>{" "}
          {originalBillDate ? formatDate(originalBillDate) : "—"}
        </div>
        <div style={{ marginBottom: "2px" }}>
          <strong>Customer:</strong> {customerName || "—"}
        </div>
      </div>

      {/* 4. Divider */}
      <div style={{ borderTop: "1px solid #e5e7eb", margin: "8px 0" }} />

      {/* 5. Items Table */}
      <table
        style={{ width: "100%", borderCollapse: "collapse", marginBottom: "8px" }}
      >
        <thead>
          <tr style={{ backgroundColor: "#f4f4f5", fontWeight: 600 }}>
            <th
              style={{
                padding: "4px",
                textAlign: "left",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              Item
            </th>
            <th
              style={{
                padding: "4px",
                textAlign: "right",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              Qty
            </th>
            <th
              style={{
                padding: "4px",
                textAlign: "right",
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              MRP
            </th>
            {mode === "exchange" && (
              <th style={{ padding: "4px", textAlign: "right", borderBottom: "1px solid #e5e7eb" }}>Credit</th>
            )}
          </tr>
        </thead>
        <tbody>
          {(items || []).map((it, idx) => (
            <tr key={idx}>
              <td
                style={{
                  padding: "4px",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {it.product_name || "—"}
                {mode === "exchange" && (it.size || it.color) && (
                  <span style={{ color: "#6b7280", fontSize: "10px" }}> ({[it.size, it.color].filter(Boolean).join(" / ")})</span>
                )}
              </td>
              <td
                style={{
                  padding: "4px",
                  textAlign: "right",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {it.quantity}
              </td>
              <td
                style={{
                  padding: "4px",
                  textAlign: "right",
                  borderBottom: "1px solid #f3f4f6",
                }}
              >
                {formatINR(it.mrp || 0, 2)}
              </td>
              {mode === "exchange" && (
                <td style={{ padding: "4px", textAlign: "right", borderBottom: "1px solid #f3f4f6" }}>{formatINR(it.creditAmount || 0, 2)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {/* 6. Divider */}
      <div style={{ borderTop: "1px solid #e5e7eb", margin: "8px 0" }} />

      {/* 7. Credit Amount Row */}
      <div
        style={{
          fontWeight: 600,
          fontSize: "13px",
          textAlign: "right",
          marginTop: "8px",
        }}
      >
        Store Credit Issued: {formatINR(creditAmount || 0, 2)}
      </div>

      {/* 8. Issue Date */}
      <div
        style={{
          fontSize: "10px",
          color: "#6b7280",
          textAlign: "right",
        }}
      >
        Issued:{" "}
        {formatDate(issueDate || new Date().toISOString())}
      </div>

      {/* 9. Note */}
      <div
        style={{
          fontSize: "10px",
          color: "#6b7280",
          marginTop: "8px",
          textAlign: "center",
        }}
      >
        {mode === "exchange"
          ? `Store credit of ${formatINR(creditAmount || 0, 2)} has been added to your account.`
          : "Store credit has been added to your account and will be automatically applied on your next purchase."}
      </div>
    </div>
  );
});

export default ReturnReceiptView;
