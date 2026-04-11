// src/admin/components/BillTable.js
import React, { useEffect, useState, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Loader2, Pencil, FileText, Trash2, Ban } from "lucide-react";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import ReturnReceiptView from "./billing/ReturnReceiptView";
import { generateInvoicePdf } from "./billing/generateInvoicePdf";

const ROWS_PER_PAGE = 15;

export default function BillTable({ onEdit }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bills, setBills] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "" });
  const [cancelBill, setCancelBill] = useState(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [receiptBill, setReceiptBill] = useState(null);
  const receiptRef = useRef(null);

  useEffect(() => {
    const loadBills = async () => {
      setLoading(true);
      let query = supabase
        .from("bills")
        .select(
          "billid, customerid, customers(first_name, last_name), orderdate, totalamount, gst_total, discount_total, paymentstatus, finalized, pdf_url",
          { count: "exact" }
        )
        .order("orderdate", { ascending: false })
        .range((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE - 1);

      if (filters.search) {
        query = query.eq("billid", filters.search);
      }

      const { data, error, count } = await query;
      if (error) {
        toast({
          title: "Error loading bills",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setBills(data || []);
        setTotalCount(count || 0);
      }
      setLoading(false);
    };

    loadBills();
  }, [page, filters, toast]);

  const openCancelFlow = (bill) => {
    setCancelBill(bill);
    setConfirmOpen(true);
  };

  const restoreStockForBill = async (billId) => {
    // TODO(CR-02): This restore uses a non-atomic read-modify-write pattern. Concurrent
    // finalize/cancel operations between the read and write can silently corrupt stock counts.
    // Fix: create a Supabase RPC `adjust_stock(p_variantid uuid, p_delta integer)` that performs
    // an atomic `UPDATE productsizecolors SET stock = stock + p_delta WHERE variantid = p_variantid`
    // and replace the block below with:
    //   await supabase.rpc('adjust_stock', { p_variantid: bi.variantid, p_delta: bi.quantity });
    // See schema/migration_adjust_stock.sql for the required migration.
    const { data: billItems } = await supabase
      .from("bill_items")
      .select("variantid, quantity")
      .eq("billid", billId)
      .not("variantid", "is", null);
    for (const bi of billItems || []) {
      const { data: variant } = await supabase
        .from("productsizecolors")
        .select("stock")
        .eq("variantid", bi.variantid)
        .single();
      if (variant) {
        await supabase
          .from("productsizecolors")
          .update({ stock: variant.stock + bi.quantity })
          .eq("variantid", bi.variantid);
      }
    }
  };

  const handleCancelDraft = async (bill) => {
    const { billid: billId } = bill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      const { error } = await supabase
        .from("bills")
        .update({ paymentstatus: "cancelled" })
        .eq("billid", billId);
      if (error) throw error;
      toast({ title: `Bill #${billId} cancelled. Stock restored.` });
      setBills((prev) =>
        prev.map((b) => (b.billid === billId ? { ...b, paymentstatus: "cancelled" } : b))
      );
      setConfirmOpen(false);
      setCancelBill(null);
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleCancelFinalizedNoCustomer = async (bill) => {
    const { billid: billId } = bill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      await supabase.from("discount_usage").delete().eq("billid", billId);
      const { error } = await supabase
        .from("bills")
        .update({ paymentstatus: "cancelled" })
        .eq("billid", billId);
      if (error) throw error;
      toast({ title: `Bill #${billId} cancelled. Stock restored. No customer on record.` });
      setBills((prev) =>
        prev.map((b) => (b.billid === billId ? { ...b, paymentstatus: "cancelled" } : b))
      );
      setConfirmOpen(false);
      setCancelBill(null);
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleResolveReturnPayment = async () => {
    if (!cancelBill) return;
    const { billid: billId, customerid, totalamount } = cancelBill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      const { data: custRow } = await supabase
        .from("customers")
        .select("total_spend")
        .eq("customerid", customerid)
        .single();
      if (custRow) {
        const newSpend = Math.max(0, Number(custRow.total_spend ?? 0) - Number(totalamount ?? 0));
        const { data: remaining } = await supabase
          .from("bills")
          .select("orderdate")
          .eq("customerid", customerid)
          .eq("finalized", true)
          .neq("billid", billId)
          .order("orderdate", { ascending: false })
          .limit(1);
        const newLastPurchase = remaining?.[0]?.orderdate
          ? new Date(remaining[0].orderdate).toISOString().slice(0, 10)
          : null;
        await supabase
          .from("customers")
          .update({ total_spend: newSpend, last_purchased_at: newLastPurchase })
          .eq("customerid", customerid);
      }
      await supabase.from("discount_usage").delete().eq("billid", billId);
      const { error } = await supabase
        .from("bills")
        .update({ paymentstatus: "cancelled" })
        .eq("billid", billId);
      if (error) throw error;
      toast({ title: `Bill #${billId} cancelled. Stock restored. Customer spend reversed.` });
      setBills((prev) =>
        prev.map((b) => (b.billid === billId ? { ...b, paymentstatus: "cancelled" } : b))
      );
      setResolveOpen(false);
      setCancelBill(null);
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleResolveIssueStoreCredit = async () => {
    if (!cancelBill) return;
    const { billid: billId, customerid, totalamount, orderdate } = cancelBill;
    const customerName = cancelBill.customers
      ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name}`
      : "";
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      const { data: custRow } = await supabase
        .from("customers")
        .select("store_credit")
        .eq("customerid", customerid)
        .single();
      if (custRow) {
        const newCredit = Number(custRow.store_credit ?? 0) + Number(totalamount ?? 0);
        await supabase
          .from("customers")
          .update({ store_credit: newCredit })
          .eq("customerid", customerid);
      }
      await supabase.from("discount_usage").delete().eq("billid", billId);
      const { error } = await supabase
        .from("bills")
        .update({ paymentstatus: "cancelled" })
        .eq("billid", billId);
      if (error) throw error;

      const { data: receiptItems } = await supabase
        .from("bill_items")
        .select("product_name, quantity, mrp")
        .eq("billid", billId);
      setReceiptBill({
        billId,
        originalBillDate: orderdate,
        customerName,
        items: receiptItems || [],
        creditAmount: Number(totalamount ?? 0),
        issueDate: new Date().toISOString(),
      });
      await new Promise((r) => setTimeout(r, 100));
      try {
        if (receiptRef.current) {
          const blob = await generateInvoicePdf(receiptRef.current);
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        }
      } catch (pdfErr) {
        toast({
          title: "Receipt PDF failed",
          description: pdfErr?.message || "Bill is cancelled. Credit added.",
          variant: "destructive",
        });
      }

      toast({
        title: `Bill #${billId} cancelled. ₹${Number(totalamount ?? 0).toFixed(2)} store credit added to ${customerName || "customer"}'s account.`,
      });
      setBills((prev) =>
        prev.map((b) => (b.billid === billId ? { ...b, paymentstatus: "cancelled" } : b))
      );
      setResolveOpen(false);
      setCancelBill(null);
      setReceiptBill(null);
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleStep1Continue = () => {
    if (!cancelBill) return;
    if (!cancelBill.finalized) {
      handleCancelDraft(cancelBill);
      return;
    }
    if (cancelBill.finalized && !cancelBill.customerid) {
      handleCancelFinalizedNoCustomer(cancelBill);
      return;
    }
    setConfirmOpen(false);
    setResolveOpen(true);
  };

  const handleDelete = async (bill) => {
    const { billid: billId, finalized, customerid, totalamount, pdf_url } = bill;
    const confirmMsg = finalized
      ? `Delete finalized Bill #${billId}? This will restore stock and reverse customer spend. This cannot be undone.`
      : `Delete draft Bill #${billId}? This will restore stock.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      // Fetch bill_items to restore stock
      const { data: billItems } = await supabase
        .from("bill_items")
        .select("variantid, quantity")
        .eq("billid", billId)
        .not("variantid", "is", null);

      // Restore stock for each inventory item
      for (const bi of billItems || []) {
        const { data: variant } = await supabase
          .from("productsizecolors")
          .select("stock")
          .eq("variantid", bi.variantid)
          .single();
        if (variant) {
          await supabase
            .from("productsizecolors")
            .update({ stock: variant.stock + bi.quantity })
            .eq("variantid", bi.variantid);
        }
      }

      // For finalized bills: reverse customer spend + delete discount_usage + remove PDF
      if (finalized && customerid) {
        const { data: custRow } = await supabase
          .from("customers")
          .select("total_spend")
          .eq("customerid", customerid)
          .single();
        if (custRow) {
          const newSpend = Math.max(0, Number(custRow.total_spend ?? 0) - Number(totalamount ?? 0));
          // Find new last_purchased_at from remaining finalized bills for this customer
          const { data: remaining } = await supabase
            .from("bills")
            .select("orderdate")
            .eq("customerid", customerid)
            .eq("finalized", true)
            .neq("billid", billId)
            .order("orderdate", { ascending: false })
            .limit(1);
          const newLastPurchase = remaining?.[0]?.orderdate
            ? new Date(remaining[0].orderdate).toISOString().slice(0, 10)
            : null;
          await supabase
            .from("customers")
            .update({ total_spend: newSpend, last_purchased_at: newLastPurchase })
            .eq("customerid", customerid);
        }
        await supabase.from("discount_usage").delete().eq("billid", billId);
        if (pdf_url) {
          await supabase.storage.from("invoices").remove([`bill-${billId}.pdf`]);
        }
      }

      await supabase.from("bill_items").delete().eq("billid", billId);
      await supabase.from("bill_salespersons").delete().eq("billid", billId);
      const { error } = await supabase.from("bills").delete().eq("billid", billId);
      if (error) throw error;

      toast({ title: `Bill #${billId} deleted` });
      setBills((prev) => prev.filter((b) => b.billid !== billId));
    } catch (e) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };

  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search by Bill ID"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="max-w-xs"
        />
        <Button variant="outline" onClick={() => setPage(1)}>
          Apply
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-left">Bill ID</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">GST</th>
                <th className="p-2 text-right">Discount</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.billid} className="border-t">
                  <td className="p-2">{b.billid}</td>
                  <td className="p-2">
                    {b.customers ? `${b.customers.first_name} ${b.customers.last_name}` : "—"}
                  </td>
                  <td className="p-2">
                    {b.orderdate ? new Date(b.orderdate).toLocaleString() : "—"}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.totalamount || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.gst_total || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.discount_total || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-center">
                    <Badge variant={
                      b.paymentstatus === "finalized" ? "default" :
                      b.paymentstatus === "cancelled" ? "destructive" : "secondary"
                    }>
                      {b.paymentstatus === "finalized" ? "Finalized" :
                       b.paymentstatus === "cancelled" ? "Cancelled" : "Draft"}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1 justify-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onEdit(b.billid)}
                        title="Edit bill"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!b.pdf_url}
                        className={!b.pdf_url ? "opacity-40 cursor-not-allowed" : ""}
                        title={b.pdf_url ? "View invoice PDF" : "PDF available after finalize"}
                        onClick={() => b.pdf_url && window.open(b.pdf_url, "_blank")}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      {b.paymentstatus !== "cancelled" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="hover:text-destructive"
                          title={b.finalized ? "Cancel finalized bill" : "Cancel bill"}
                          aria-label="Cancel bill"
                          onClick={() => openCancelFlow(b)}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        title={b.finalized ? "Delete finalized bill (restores stock)" : "Delete draft"}
                        onClick={() => handleDelete(b)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-4 text-center text-muted-foreground"
                  >
                    No bills found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          Page {page} of {totalPages || 1}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Dialog 1 — Step 1 confirm */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) { setConfirmOpen(false); setCancelBill(null); } }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cancelBill?.finalized ? `Cancel Finalized Bill #${cancelBill?.billid}?` : `Cancel Draft Bill #${cancelBill?.billid}?`}
            </DialogTitle>
            <DialogDescription>
              This will restore stock for all items. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {cancelBill && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">Customer:</span>{" "}
                {cancelBill.customers ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name}` : "—"}
              </div>
              <div>
                <span className="font-semibold">Date:</span>{" "}
                {cancelBill.orderdate ? new Date(cancelBill.orderdate).toLocaleString() : "—"}
              </div>
              <div>
                <span className="font-semibold">Grand Total:</span> ₹{Number(cancelBill.totalamount ?? 0).toFixed(2)}
              </div>
              <div>
                <span className="font-semibold">Status:</span> {cancelBill.finalized ? "Finalized" : "Draft"}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" disabled={cancelSaving} onClick={() => { setConfirmOpen(false); setCancelBill(null); }}>
              Keep Bill
            </Button>
            <Button
              variant={cancelBill?.finalized ? "default" : "destructive"}
              disabled={cancelSaving}
              onClick={handleStep1Continue}
            >
              {cancelSaving ? "Working..." : (cancelBill?.finalized ? "Continue" : "Cancel Draft")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog 2 — Step 2 resolution */}
      <Dialog open={resolveOpen} onOpenChange={(o) => { if (!o) { setResolveOpen(false); setCancelBill(null); } }}>
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>How would you like to resolve this?</DialogTitle>
            <DialogDescription>
              {cancelBill && `Bill #${cancelBill.billid} (₹${Number(cancelBill.totalamount ?? 0).toFixed(2)}) was finalized. Choose a resolution for the customer.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <Button
              variant="outline"
              className="w-full justify-start h-auto py-3"
              disabled={cancelSaving}
              onClick={handleResolveReturnPayment}
            >
              <div className="text-left">
                <div className="font-semibold">Return payment to customer</div>
                <div className="text-xs text-muted-foreground">Reverses customer spend. No store credit issued.</div>
              </div>
            </Button>
            <Button
              className="w-full justify-start h-auto py-3"
              disabled={cancelSaving}
              onClick={handleResolveIssueStoreCredit}
            >
              <div className="text-left">
                <div className="font-semibold">Issue store credit</div>
                <div className="text-xs opacity-90">
                  ₹{Number(cancelBill?.totalamount ?? 0).toFixed(2)} added to{" "}
                  {cancelBill?.customers
                    ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name}`
                    : "customer"}
                  's account. A return receipt will be printed.
                </div>
              </div>
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button variant="ghost" disabled={cancelSaving} onClick={() => { setResolveOpen(false); setCancelBill(null); }}>
              Go Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Off-screen ReturnReceiptView for PDF capture */}
      {receiptBill && (
        <div style={{ position: "fixed", top: "-9999px", left: "-9999px", pointerEvents: "none" }} aria-hidden="true">
          <ReturnReceiptView
            ref={receiptRef}
            billId={receiptBill.billId}
            originalBillDate={receiptBill.originalBillDate}
            customerName={receiptBill.customerName}
            items={receiptBill.items}
            creditAmount={receiptBill.creditAmount}
            issueDate={receiptBill.issueDate}
          />
        </div>
      )}
    </div>
  );
}
