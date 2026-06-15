// src/admin/components/SupplierLedgerDialog.js
import React, { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { logActivity } from "../../lib/activityLog";
import { formatDate } from "../../utility/dateFormat";
import { computeRunningLedger, computeSummary } from "../../utility/supplierBalance";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

function LineItemProductLink({ lineItem, onLinked }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(lineItem.product_id ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const productId = value.trim() || null;
    const { error } = await supabase
      .from("supplier_bill_line_items")
      .update({ product_id: productId })
      .eq("line_item_id", lineItem.line_item_id);
    setSaving(false);
    if (error) {
      toast.error("Failed to link product", { description: error.message });
    } else {
      logActivity({
        action: "update",
        entityType: "supplier_bill",
        entityId: lineItem.transaction_id,
        summary: productId
          ? `Linked product ${productId} to supplier bill line item "${lineItem.description || lineItem.line_item_id}"`
          : `Unlinked product from supplier bill line item "${lineItem.description || lineItem.line_item_id}"`,
      });
      toast.success(productId ? `Linked ${productId}` : "Product unlinked");
      setEditing(false);
      onLinked?.({ ...lineItem, product_id: productId });
    }
  };

  if (!editing) {
    return (
      <span
        className="text-blue-600 hover:underline cursor-pointer text-xs"
        onClick={() => setEditing(true)}
      >
        {lineItem.product_id ?? "Link product"}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value.toUpperCase())}
        placeholder="BC25001"
        className="h-6 text-xs w-24 uppercase"
        autoFocus
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
      />
      <button onClick={save} disabled={saving} className="text-green-600 hover:text-green-800 text-xs font-medium">✓</button>
      <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
    </span>
  );
}

const formatINR = (val, decimals = 0) =>
  val == null ? "—" : "₹" + Number(val).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

const balanceClass = (val) =>
  val > 0 ? "text-red-600 font-semibold" : val < 0 ? "text-green-600 font-semibold" : "text-gray-700";

export default function SupplierLedgerDialog({ supplier, open, onOpenChange, onAddTransaction }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [openingBalance, setOpeningBalance] = useState(0);

  const handleViewBill = async (path) => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("supplier-bills").createSignedUrl(path, 3600);
    if (error) {
      toast.error("Error opening bill document", { description: error.message });
      return;
    }
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const handleLineItemLinked = (txnId, updatedItem) => {
    setRows((prev) =>
      prev.map((r) =>
        r.transaction_id === txnId
          ? {
              ...r,
              supplier_bill_line_items: r.supplier_bill_line_items?.map((li) =>
                li.line_item_id === updatedItem.line_item_id ? updatedItem : li
              ),
            }
          : r
      )
    );
  };

  useEffect(() => {
    if (open && supplier) {
      fetchLedger();
    }
  }, [open, supplier]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLedger = async () => {
    setLoading(true);

    const [{ data: supplierData }, { data: txns, error: txnErr }, { data: bills }] =
      await Promise.all([
        supabase
          .from("suppliers")
          .select("opening_balance, opening_balance_date")
          .eq("supplierid", supplier.supplierid)
          .single(),
        supabase
          .from("supplier_transactions")
          .select("*, supplier_bill_line_items(*)")
          .eq("supplier_id", supplier.supplierid)
          .order("transaction_date", { ascending: true })
          .order("transaction_id", { ascending: true }),
        supabase
          .from("supplier_bills")
          .select("transaction_id, storage_path, bill_id")
          .eq("supplier_id", supplier.supplierid)
          .order("bill_id"),
      ]);

    if (txnErr) {
      console.error("Error fetching transactions:", txnErr.message);
      setLoading(false);
      return;
    }

    const billsByTxn = {};
    (bills || []).forEach((b) => {
      (billsByTxn[b.transaction_id] ||= []).push(b.storage_path);
    });

    const ob = Number(supplierData?.opening_balance) || 0;
    const openingBalanceDate = supplierData?.opening_balance_date ?? null;
    const computed = computeRunningLedger(txns || [], ob, openingBalanceDate).map((row) => ({
      ...row,
      billPaths: row.transaction_id !== "opening" ? (billsByTxn[row.transaction_id] || []) : [],
    }));

    setOpeningBalance(ob);
    setRows(computed);
    setLoading(false);
  };

  const txnRows = rows.filter((r) => r.transaction_id !== "opening");
  const summary = computeSummary(txnRows, openingBalance);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-white rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle>Ledger — {supplier?.name}</DialogTitle>
          <DialogDescription>
            Chronological record of all bills and payments.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 mt-2">
          <Button size="sm" onClick={() => onAddTransaction?.("bill")}>+ Bill</Button>
          <Button size="sm" variant="outline" onClick={() => onAddTransaction?.("payment")}>+ Payment</Button>
          <Button size="sm" variant="outline" onClick={() => onAddTransaction?.("advance")}>+ Advance</Button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            No transactions yet.
          </div>
        ) : (
          <>
            <ScrollArea className={rows.length > 20 ? "h-[480px]" : undefined}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="p-2 text-left font-semibold">Date</th>
                    <th className="p-2 text-left font-semibold">Type</th>
                    <th className="p-2 text-left font-semibold">Invoice</th>
                    <th className="p-2 text-right font-semibold">Debit (Bill)</th>
                    <th className="p-2 text-right font-semibold">Credit (Paid)</th>
                    <th className="p-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <React.Fragment key={row.transaction_id}>
                      <tr
                        className={`border-t hover:bg-gray-50 cursor-pointer ${expandedRow === row.transaction_id ? "bg-blue-50" : ""}`}
                        onClick={() => setExpandedRow(expandedRow === row.transaction_id ? null : row.transaction_id)}
                      >
                        <td className="p-2 whitespace-nowrap text-muted-foreground text-xs">
                          {row.type === "opening"
                            ? (row.opening_balance_date ? formatDate(row.opening_balance_date) : "—")
                            : formatDate(row.transaction_date)}
                        </td>
                        <td className="p-2">
                          {row.type === "opening" ? (
                            <span className="text-xs text-muted-foreground italic">Opening Balance</span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={
                                row.type === "bill"
                                  ? "bg-red-100 text-red-700 border-none"
                                  : row.type === "advance"
                                  ? "bg-yellow-100 text-yellow-700 border-none"
                                  : "bg-green-100 text-green-700 border-none"
                              }
                            >
                              {row.type === "bill" ? "Bill" : row.type === "advance" ? "Advance" : "Payment"}
                            </Badge>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {row.invoice_number || "—"}
                        </td>
                        <td className="p-2 text-right tabular-nums text-red-600">
                          {row.type === "bill" ? formatINR(row.amount, 2) : ""}
                        </td>
                        <td className="p-2 text-right tabular-nums text-green-600">
                          {row.type === "payment" || row.type === "advance" ? formatINR(row.amount, 2) : ""}
                        </td>
                        <td className={`p-2 text-right tabular-nums ${balanceClass(row.running)}`}>
                          {formatINR(row.running, 2)}
                        </td>
                      </tr>

                      {expandedRow === row.transaction_id && row.type !== "opening" && (
                        <tr className="bg-blue-50 border-t border-blue-100">
                          <td colSpan={6} className="px-4 py-3">
                            {row.type === "bill" ? (
                              <div className="space-y-2 text-xs">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                  {row.invoice_number && <div><span className="font-medium">Invoice:</span> {row.invoice_number}</div>}
                                  {row.gross_amount && <div><span className="font-medium">Gross:</span> {formatINR(row.gross_amount, 2)}</div>}
                                  {row.discount_amount && <div><span className="font-medium">Discount:</span> {formatINR(row.discount_amount, 2)}</div>}
                                  {row.taxable_amount && <div><span className="font-medium">Taxable:</span> {formatINR(row.taxable_amount, 2)}</div>}
                                  {row.cgst_amount && <div><span className="font-medium">CGST:</span> {formatINR(row.cgst_amount, 2)}</div>}
                                  {row.sgst_amount && <div><span className="font-medium">SGST:</span> {formatINR(row.sgst_amount, 2)}</div>}
                                  {row.igst_amount && <div><span className="font-medium">IGST:</span> {formatINR(row.igst_amount, 2)}</div>}
                                  {row.round_off_amount != null && Number(row.round_off_amount) !== 0 && <div><span className="font-medium">Round Off:</span> {formatINR(row.round_off_amount, 2)}</div>}
                                  {row.notes && <div className="col-span-2"><span className="font-medium">Notes:</span> {row.notes}</div>}
                                  {row.billPaths?.length > 0 && (
                                    <div className="col-span-2 flex flex-wrap gap-3">
                                      {row.billPaths.map((path, i) => (
                                        <button
                                          key={i}
                                          type="button"
                                          onClick={() => handleViewBill(path)}
                                          className="text-blue-600 hover:underline font-medium"
                                        >
                                          View Bill{row.billPaths.length > 1 ? ` ${i + 1}` : ""} ↗
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                                {row.supplier_bill_line_items?.length > 0 && (
                                  <table className="min-w-full border rounded text-xs mt-1">
                                    <thead className="bg-gray-100">
                                      <tr>
                                        <th className="p-1 text-left">Description</th>
                                        <th className="p-1 text-left">HSN</th>
                                        <th className="p-1 text-right">Qty</th>
                                        <th className="p-1 text-left">Unit</th>
                                        <th className="p-1 text-right">Disc %</th>
                                        <th className="p-1 text-right">Price</th>
                                        <th className="p-1 text-right">Amount</th>
                                        <th className="p-1 text-left">Product</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {row.supplier_bill_line_items.map((li) => (
                                        <tr key={li.line_item_id} className="border-t">
                                          <td className="p-1">{li.description}</td>
                                          <td className="p-1 text-muted-foreground">{li.hsn_code || "—"}</td>
                                          <td className="p-1 text-right">{li.qty}</td>
                                          <td className="p-1">{li.unit || "—"}</td>
                                          <td className="p-1 text-right">{li.discount_pct ? `${li.discount_pct}%` : "—"}</td>
                                          <td className="p-1 text-right">{formatINR(li.unit_price, 2)}</td>
                                          <td className="p-1 text-right font-medium">{formatINR(li.amount, 2)}</td>
                                          <td className="p-1">
                                            <LineItemProductLink
                                              lineItem={li}
                                              onLinked={(updated) => handleLineItemLinked(row.transaction_id, updated)}
                                            />
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            ) : (
                              <div className="flex gap-6 text-xs">
                                {row.payment_mode && <div><span className="font-medium">Mode:</span> {row.payment_mode}</div>}
                                {row.notes && <div><span className="font-medium">Notes:</span> {row.notes}</div>}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {/* Footer summary bar */}
            <div className="border-t pt-3 mt-2 flex justify-between items-center text-sm flex-wrap gap-2">
              <div className="flex gap-6 text-muted-foreground">
                <span>Total Billed: <span className="font-semibold text-red-600">{formatINR(summary.totalBilled, 2)}</span></span>
                <span>Total Paid: <span className="font-semibold text-green-600">{formatINR(summary.totalPaid, 2)}</span></span>
              </div>
              <span className="font-bold">
                Net Balance:{" "}
                <span className={balanceClass(summary.netBalance)}>
                  {formatINR(summary.netBalance, 2)}
                </span>
                {summary.netBalance > 0 && <span className="ml-1 text-xs text-red-500 font-normal">(owed)</span>}
                {summary.netBalance < 0 && <span className="ml-1 text-xs text-green-500 font-normal">(credit)</span>}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
