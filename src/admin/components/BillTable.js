// src/admin/components/BillTable.js
import React, { useEffect, useState, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Loader2, Pencil, FileText, Trash2, Ban, RefreshCw } from "lucide-react";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import ReturnReceiptView from "./billing/ReturnReceiptView";
import InvoiceView from "./billing/InvoiceView";
import { generateInvoicePdf } from "./billing/generateInvoicePdf";
import { computeBillTotals } from "./billing/billUtils";
import { backCalcDiscountPct } from "./billing/stockHelpers";

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
  const [regenBillData, setRegenBillData] = useState(null);
  const regenRef = useRef(null);
  const [regeningBills, setRegeningBills] = useState(new Set());

  const handleRegenPdf = async (bill) => {
    const { billid: billId } = bill;
    setRegeningBills((prev) => new Set(prev).add(billId));
    try {
      // Fetch bill core data
      const { data: billRow, error: billErr } = await supabase
        .from("bills")
        .select("applied_codes, payment_amount, saleslocationid, salesmethodid, store_credit_used, orderdate, customerid, bill_number")
        .eq("billid", billId)
        .single();
      if (billErr) throw billErr;

      // Fetch bill items
      const { data: billItems } = await supabase.from("bill_items").select("*").eq("billid", billId);

      // Fetch variants
      const inventoryItems = (billItems || []).filter(bi => bi.variantid);
      let variantMap = {};
      if (inventoryItems.length > 0) {
        const { data: variants } = await supabase
          .from("productsizecolors").select("variantid, size, color")
          .in("variantid", inventoryItems.map(bi => bi.variantid));
        variantMap = Object.fromEntries((variants || []).map(v => [v.variantid, v]));
      }

      // Fetch manual items
      const manualItems = (billItems || []).filter(bi => !bi.variantid && bi.product_code);
      let manualMap = {};
      if (manualItems.length > 0) {
        const { data: manuals } = await supabase
          .from("manual_items").select("manual_item_id, size, color")
          .in("manual_item_id", manualItems.map(bi => bi.product_code));
        manualMap = Object.fromEntries((manuals || []).map(m => [m.manual_item_id, m]));
      }

      const items = (billItems || []).map(bi => ({
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
        size: variantMap[bi.variantid]?.size || manualMap[bi.product_code]?.size || null,
        color: variantMap[bi.variantid]?.color || manualMap[bi.product_code]?.color || null,
      }));

      // Fetch discounts matching applied codes
      const appliedCodes = billRow.applied_codes || [];
      let allDiscounts = [];
      if (appliedCodes.length > 0) {
        const { data: discData } = await supabase
          .from("discounts").select("id, code, type, value, max_discount, category, exclusive, auto_apply, min_total, start_date, end_date, active, rules")
          .in("code", appliedCodes);
        allDiscounts = discData || [];
      }

      // Customer name
      let customerName = "";
      if (billRow.customerid) {
        const { data: cust } = await supabase
          .from("customers").select("first_name, last_name").eq("customerid", billRow.customerid).single();
        if (cust) customerName = `${cust.first_name} ${cust.last_name}`;
      }

      // Salesperson names
      const { data: spData } = await supabase
        .from("bill_salespersons").select("salesperson_id").eq("billid", billId);
      let salespersonNames = [];
      if (spData?.length) {
        const { data: spNames } = await supabase
          .from("salespersons").select("name").in("salesperson_id", spData.map(r => r.salesperson_id));
        salespersonNames = (spNames || []).map(r => r.name);
      }

      // Payment method name
      let paymentMethod = "";
      if (billRow.salesmethodid) {
        const { data: meth } = await supabase
          .from("salesmethods").select("methodname").eq("salesmethodid", billRow.salesmethodid).single();
        paymentMethod = meth?.methodname || "";
      }

      // Voucher (if any)
      let appliedVoucher = null;
      const { data: voucherRow } = await supabase
        .from("vouchers").select("voucher_id, value").eq("redeemed_billid", billId).maybeSingle();
      if (voucherRow) appliedVoucher = { voucher_id: voucherRow.voucher_id, value: Number(voucherRow.value ?? 0) };

      const computed = computeBillTotals(items, appliedCodes, allDiscounts);

      flushSync(() => setRegenBillData({
        billId,
        billNumber: billRow.bill_number || null,
        billDate: new Date(billRow.orderdate),
        customerName,
        salespersonNames,
        items,
        computed,
        paymentMethod,
        paymentAmount: billRow.payment_amount ?? 0,
        appliedCodes,
        allDiscounts,
        appliedVoucher,
        appliedStoreCredit: Number(billRow.store_credit_used ?? 0),
      }));

      if (!regenRef.current) throw new Error("Invoice ref missing");
      const blob = await generateInvoicePdf(regenRef.current);
      // Use versioned filename so each regen gets a guaranteed-fresh URL (no CDN/browser cache)
      const newPath = `bill-${billId}-v${Date.now()}.pdf`;
      // Delete legacy path and any previous versioned file stored in pdf_url
      const oldPaths = [`bill-${billId}.pdf`];
      if (bill.pdf_url) {
        const stored = decodeURIComponent(bill.pdf_url.split('/invoices/')[1]?.split('?')[0] || '');
        if (stored && stored !== `bill-${billId}.pdf`) oldPaths.push(stored);
      }
      await supabase.storage.from("invoices").remove(oldPaths);
      const { error: upErr } = await supabase.storage
        .from("invoices").upload(newPath, blob, { contentType: "application/pdf" });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("invoices").getPublicUrl(newPath);
      const pdfUrl = urlData?.publicUrl ?? null;
      if (pdfUrl) {
        await supabase.from("bills").update({ pdf_url: pdfUrl }).eq("billid", billId);
        setBills((prev) => prev.map((b) => b.billid === billId ? { ...b, pdf_url: pdfUrl } : b));
        window.open(pdfUrl, "_blank");
      }
      toast({ title: `PDF regenerated for Bill #${billId}` });
    } catch (e) {
      toast({ title: "PDF generation failed", description: e.message, variant: "destructive" });
    } finally {
      setRegenBillData(null);
      setRegeningBills((prev) => { const s = new Set(prev); s.delete(billId); return s; });
    }
  };

  useEffect(() => {
    const loadBills = async () => {
      setLoading(true);
      let query = supabase
        .from("bills")
        .select(
          "billid, bill_number, customerid, customers(first_name, last_name), orderdate, totalamount, gst_total, discount_total, payment_amount, paymentstatus, finalized, pdf_url",
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

  // Refund bills.store_credit_used back to customers.store_credit if > 0.
  // No-op if the bill has no customer or the column is 0/null.
  const refundStoreCreditForBill = async (billId, customerid) => {
    if (!customerid) return;
    const { data: billRow } = await supabase
      .from("bills")
      .select("store_credit_used")
      .eq("billid", billId)
      .single();
    const refund = Number(billRow?.store_credit_used ?? 0);
    if (!(refund > 0)) return;
    const { data: custRow } = await supabase
      .from("customers")
      .select("store_credit")
      .eq("customerid", customerid)
      .single();
    if (!custRow) return;
    const newBalance = Number(custRow.store_credit ?? 0) + refund;
    await supabase
      .from("customers")
      .update({ store_credit: newBalance })
      .eq("customerid", customerid);
  };

  const handleCancelDraft = async (bill) => {
    const { billid: billId, customerid } = bill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      await refundStoreCreditForBill(billId, customerid);
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

  // WR-03: Reset voucher redemption if the bill used a promotional voucher
  const unRedeemVoucherForBill = async (billId) => {
    const { data: voucherRow } = await supabase
      .from("vouchers")
      .select("voucher_id")
      .eq("redeemed_billid", billId)
      .maybeSingle();
    if (voucherRow) {
      await supabase
        .from("vouchers")
        .update({ redeemed: false, redeemed_at: null, redeemed_billid: null })
        .eq("voucher_id", voucherRow.voucher_id);
    }
  };

  const handleCancelFinalizedNoCustomer = async (bill) => {
    const { billid: billId, customerid } = bill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      await refundStoreCreditForBill(billId, customerid);
      await unRedeemVoucherForBill(billId);
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
    const { billid: billId, customerid } = cancelBill;
    setCancelSaving(true);
    try {
      await restoreStockForBill(billId);
      await refundStoreCreditForBill(billId, customerid);
      await unRedeemVoucherForBill(billId);
      await supabase.from("discount_usage").delete().eq("billid", billId);
      const { error } = await supabase
        .from("bills")
        .update({ paymentstatus: "cancelled" })
        .eq("billid", billId);
      if (error) throw error;
      toast({ title: `Bill #${billId} cancelled. Stock restored.` });
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
      await refundStoreCreditForBill(billId, customerid);
      // WR-04: Fetch net_amount (actual cash collected) so we credit only what the customer paid.
      // Falls back to totalamount if the net_amount column has not been migrated yet.
      const { data: billRow } = await supabase
        .from("bills")
        .select("net_amount")
        .eq("billid", billId)
        .single();
      const refundAmount = Number(billRow?.net_amount ?? totalamount ?? 0);
      const { data: custRow } = await supabase
        .from("customers")
        .select("store_credit")
        .eq("customerid", customerid)
        .single();
      if (custRow) {
        const newCredit = Number(custRow.store_credit ?? 0) + refundAmount;
        await supabase
          .from("customers")
          .update({ store_credit: newCredit })
          .eq("customerid", customerid);
      }
      await unRedeemVoucherForBill(billId);
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
      flushSync(() => {
        setReceiptBill({
          billId,
          originalBillDate: orderdate,
          customerName,
          items: receiptItems || [],
          creditAmount: refundAmount,
          issueDate: new Date().toISOString(),
        });
      });
      try {
        if (receiptRef.current) {
          const blob = await generateInvoicePdf(receiptRef.current, 'a5');
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
        title: `Bill #${billId} cancelled. ₹${refundAmount.toFixed(2)} store credit added to ${customerName || "customer"}'s account.`,
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
    const { billid: billId, finalized, customerid, pdf_url } = bill;
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

      // For finalized bills: refund store credit + delete discount_usage + remove PDF
      if (finalized && customerid) {
        await refundStoreCreditForBill(billId, customerid);
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
                  <td className="p-2">
                    <div>{b.bill_number || b.billid}</div>
                    {b.bill_number && <div className="text-xs text-muted-foreground">ID: {b.billid}</div>}
                  </td>
                  <td className="p-2">
                    {b.customers ? `${b.customers.first_name} ${b.customers.last_name}` : "—"}
                  </td>
                  <td className="p-2">
                    {b.orderdate ? new Date(b.orderdate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
                  </td>
                  <td className="p-2 text-right">
                    ₹{((b.totalamount || 0) + (b.discount_total || 0)).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.gst_total || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    {b.discount_total != null && b.discount_total > 0
                      ? `₹${Number(b.discount_total).toFixed(2)}`
                      : "—"}
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
                      {b.finalized && (
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={regeningBills.has(b.billid)}
                          title="Regenerate PDF"
                          onClick={() => handleRegenPdf(b)}
                        >
                          {regeningBills.has(b.billid)
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <RefreshCw className="h-4 w-4" />}
                        </Button>
                      )}
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
                {cancelBill.orderdate ? new Date(cancelBill.orderdate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "—"}
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
        <DialogContent className="bg-white max-w-md max-h-[90vh] overflow-y-auto">
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

      {/* Off-screen InvoiceView for PDF regen */}
      {regenBillData && (
        <div style={{ position: "fixed", top: "-9999px", left: "-9999px", pointerEvents: "none" }} aria-hidden="true">
          <InvoiceView
            ref={regenRef}
            billId={regenBillData.billId}
            billNumber={regenBillData.billNumber}
            billDate={regenBillData.billDate}
            customerName={regenBillData.customerName}
            salespersonNames={regenBillData.salespersonNames}
            items={regenBillData.items}
            computed={regenBillData.computed}
            paymentMethod={regenBillData.paymentMethod}
            paymentAmount={regenBillData.paymentAmount}
            appliedCodes={regenBillData.appliedCodes}
            allDiscounts={regenBillData.allDiscounts}
            appliedVoucher={regenBillData.appliedVoucher}
            appliedStoreCredit={regenBillData.appliedStoreCredit}
          />
        </div>
      )}

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
