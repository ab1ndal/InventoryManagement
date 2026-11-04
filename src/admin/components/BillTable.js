// src/admin/components/BillTable.js
import React, { useEffect, useState, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Loader2, Pencil, FileText, Trash2, Ban, RefreshCw, MessageSquare, Globe } from "lucide-react";
import { isWebsiteMethod } from "./billing/paymentHelpers";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import ReturnReceiptView from "./billing/ReturnReceiptView";
import { generateInvoicePdf } from "./billing/generateInvoicePdf";
import { useBillPdf } from "./billing/useBillPdf";
import { openBillPdf, withOrderContact } from "./billing/billPdf";
import { formatDate } from "../../utility/dateFormat";
import { formatINR } from "../../utility/formatCurrency";
import { logActivity } from "../../lib/activityLog";
import { money, customerName } from "../../utility/activitySummary";

const ROWS_PER_PAGE = 50;

const DEFAULT_SORT = { key: "bill_number", dir: "desc" };

const SORTABLE_COLUMNS = {
  bill_number: "bill_number",
  orderdate: "orderdate",
  totalamount: "totalamount",
  gst_total: "gst_total",
  discount_total: "discount_total",
  paymentstatus: "paymentstatus",
};

export default function BillTable({ onEdit }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bills, setBills] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({ search: "" });
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'bos' | 'invoice'
  const [sort, setSort] = useState({ key: "bill_number", dir: "desc" });
  const [cancelBill, setCancelBill] = useState(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [receiptBill, setReceiptBill] = useState(null);
  const receiptRef = useRef(null);
  const { generate: generateBillPdf, offscreen: billPdfOffscreen } = useBillPdf();
  const [regeningBills, setRegeningBills] = useState(new Set());

  const handleRegenPdf = async (bill) => {
    const { billid: billId } = bill;
    setRegeningBills((prev) => new Set(prev).add(billId));
    try {
      const newPath = await generateBillPdf(billId);
      setBills((prev) => prev.map((b) => b.billid === billId ? { ...b, pdf_url: newPath } : b));
      await openBillPdf(newPath);
      toast({ title: `PDF regenerated for Bill #${billId}` });
    } catch (e) {
      toast({ title: "PDF generation failed", description: e.message, variant: "destructive" });
    } finally {
      setRegeningBills((prev) => { const s = new Set(prev); s.delete(billId); return s; });
    }
  };

  const handleViewPdf = async (bill) => {
    if (!bill.pdf_url) return;
    try {
      await openBillPdf(bill.pdf_url);
    } catch (e) {
      toast({ title: "Could not open PDF", description: e.message, variant: "destructive" });
    }
  };

  const [sendingSms, setSendingSms] = useState(new Set());

  const handleSendSms = async (bill) => {
    const { billid: billId, bill_number, pdf_url, net_amount, payment_amount, customers } = bill;
    // Open a blank tab synchronously inside the click gesture, then redirect it
    // once the phone + signed URL are ready. Opening after the awaits below would
    // be blocked by the browser's popup blocker (gesture no longer "active").
    const waWindow = window.open("", "_blank");
    setSendingSms((prev) => new Set(prev).add(billId));
    try {
      // Customer phone — fetch only what we need
      let customerName = customers ? `${customers.first_name} ${customers.last_name || ""}`.trim() : "";
      let customerPhone = "";
      let rawPhone = bill.contact_phone;
      if (!rawPhone) {
        const { data: cust } = await supabase
          .from("customers")
          .select("phone")
          .eq("customerid", bill.customerid)
          .single();
        rawPhone = cust?.phone;
      }
      if (rawPhone) {
        const digits = rawPhone.replace(/\D/g, "");
        // Bare 10-digit number = Indian mobile, prepend country code
        customerPhone = digits.length === 10 ? `91${digits}` : digits;
      }

      if (!customerPhone) {
        waWindow?.close();
        toast({ title: "No phone number", description: "Customer has no phone on record.", variant: "destructive" });
        return;
      }

      // Generate 7-day signed URL using stored path (handles versioned filenames)
      let signedUrl = "";
      if (pdf_url) {
        const pdfPath = pdf_url.includes('/invoices/')
          ? decodeURIComponent(pdf_url.split('/invoices/')[1]?.split('?')[0] || '')
          : pdf_url;
        const { data: signedData } = await supabase.storage
          .from("invoices")
          .createSignedUrl(pdfPath, 7 * 24 * 60 * 60);
        signedUrl = signedData?.signedUrl ?? "";
      }

      const amount = Math.round(Number(net_amount ?? payment_amount ?? 0));

      // Shorten the long signed URL for a cleaner WhatsApp message (best-effort;
      // TinyURL is free/keyless and sends CORS headers. Falls back to the full
      // URL if the shortener is unreachable, so a send never fails on it).
      let shareUrl = signedUrl;
      if (signedUrl) {
        try {
          const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(signedUrl)}`);
          if (res.ok) {
            const short = (await res.text()).trim();
            if (short.startsWith("http")) shareUrl = short;
          }
        } catch {
          // shortener down — keep the full URL
        }
      }

      // Free, backend-less WhatsApp: open a click-to-chat link with the bill
      // pre-filled. Staff reviews and taps send in WhatsApp.
      const message =
        `Hi ${customerName || "there"}, here is your bill #${bill_number || billId} from Bindals Creation.\n` +
        `Amount: ₹${amount}` +
        (shareUrl ? `\nView bill: ${shareUrl}` : "");
      const waUrl = `https://wa.me/${customerPhone}?text=${encodeURIComponent(message)}`;

      if (waWindow) waWindow.location.href = waUrl;
      else window.open(waUrl, "_blank", "noopener,noreferrer");

      toast({ title: "WhatsApp opened", description: `Review the message and tap send for bill #${bill_number || billId}.` });
    } catch (e) {
      waWindow?.close();
      toast({ title: "Couldn't open WhatsApp", description: e.message, variant: "destructive" });
    } finally {
      setSendingSms((prev) => { const s = new Set(prev); s.delete(billId); return s; });
    }
  };

  // A new search always starts at page 1: matches may not reach the current page.
  useEffect(() => {
    if (searchInput === filters.search) return;
    const t = setTimeout(() => {
      setPage(1);
      setFilters({ search: searchInput });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, filters.search]);

  useEffect(() => {
    let superseded = false;
    const loadBills = async () => {
      setLoading(true);
      let query = supabase
        .from("bills")
        .select(
          "billid, bill_number, customerid, customers(first_name, last_name), orders(contact_name, contact_phone), orderdate, totalamount, gst_total, discount_total, payment_amount, net_amount, store_credit_used, exchange_credit_used, paymentstatus, finalized, pdf_url, document_type, salesmethods(methodname), bill_payments(amount)"
        )
        .order(SORTABLE_COLUMNS[sort.key] || DEFAULT_SORT.key, {
          ascending: sort.dir === "asc",
          nullsFirst: false,
        })
        .range((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE); // fetch 51 to detect next page

      if (typeFilter !== "all") query = query.eq("document_type", typeFilter);

      const term = filters.search.trim();
      if (term) {
        // Strip chars that would break PostgREST .or() filter syntax
        const safeTerm = term.replace(/[,()]/g, "");

        // Find customers matching name or phone
        const customerIds = new Set();
        // "First Last" full-name search: match first word against first_name, last word against last_name
        const words = safeTerm.split(/\s+/).filter(Boolean);
        const [
          { data: nameOrPhoneMatches },
          { data: fullNameMatches },
          // Online bills are also found by who the order is for.
          { data: orderMatches, error: orderMatchErr },
        ] = await Promise.all([
          supabase
            .from("customers")
            .select("customerid")
            .or(`first_name.ilike.%${safeTerm}%,last_name.ilike.%${safeTerm}%,phone.ilike.%${safeTerm}%`),
          words.length >= 2
            ? supabase
                .from("customers")
                .select("customerid")
                .ilike("first_name", `%${words[0]}%`)
                .ilike("last_name", `%${words[words.length - 1]}%`)
            : { data: [] },
          supabase.from("orders").select("bill_id").ilike("contact_name", `%${safeTerm}%`),
        ]);
        for (const c of nameOrPhoneMatches || []) customerIds.add(c.customerid);
        for (const c of fullNameMatches || []) customerIds.add(c.customerid);
        if (superseded) return;
        if (orderMatchErr) {
          toast({ title: "Error loading bills", description: orderMatchErr.message, variant: "destructive" });
          setLoading(false);
          return;
        }
        const orderBillIds = (orderMatches || []).map((o) => o.bill_id).filter(Boolean);

        const orParts = [`bill_number.ilike.%${safeTerm}%`];
        if (/^\d+$/.test(safeTerm)) orParts.push(`billid.eq.${safeTerm}`);
        if (customerIds.size > 0) orParts.push(`customerid.in.(${[...customerIds].join(",")})`);
        if (orderBillIds.length > 0) orParts.push(`billid.in.(${orderBillIds.join(",")})`);
        query = query.or(orParts.join(","));
      }

      const { data, error } = await query;
      if (superseded) return;
      if (error) {
        toast({
          title: "Error loading bills",
          description: error.message,
          variant: "destructive",
        });
      } else {
        const hasNext = (data || []).length > ROWS_PER_PAGE;
        const pageBills = (data || []).slice(0, ROWS_PER_PAGE);

        // Amount Received = total cash collected for the bill.
        // bills.payment_amount tracks that running total, but bill_payments is the
        // ledger of record, so sum it when rows exist and fall back to payment_amount
        // for bills paid in one go (which write no bill_payments row).
        setBills(
          pageBills.map((b) => ({
            ...withOrderContact(b),
            amount_received: b.bill_payments?.length
              ? b.bill_payments.reduce((sum, p) => sum + Number(p.amount), 0)
              : b.payment_amount != null
                ? Number(b.payment_amount)
                : null,
          }))
        );
        setHasNextPage(hasNext);
      }
      setLoading(false);
    };

    loadBills();
    return () => {
      superseded = true;
    };
  }, [page, filters, sort, toast, typeFilter]);

  // Cycle a column header through ascending → descending → no-sort (back to default: Bill Number desc).
  const handleSortClick = (key) => {
    setPage(1);
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return { ...DEFAULT_SORT };
    });
  };

  const sortIndicator = (key) =>
    sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  const openCancelFlow = (bill) => {
    setCancelBill(bill);
    setConfirmOpen(true);
  };

  const restoreStockForBill = async (billId) => {
    const { data: billItems } = await supabase
      .from("bill_items")
      .select("bill_item_id, variantid, quantity")
      .eq("billid", billId)
      .not("variantid", "is", null);

    // Deduct already-exchanged quantities — those items were restocked at exchange time
    const billItemIds = (billItems || []).map((bi) => bi.bill_item_id);
    let exchangedQtyMap = {};
    if (billItemIds.length > 0) {
      const { data: exchanges } = await supabase
        .from("exchanges")
        .select("original_bill_item_id, quantity")
        .in("original_bill_item_id", billItemIds);
      for (const ex of exchanges || []) {
        exchangedQtyMap[ex.original_bill_item_id] =
          (exchangedQtyMap[ex.original_bill_item_id] || 0) + Number(ex.quantity);
      }
    }

    // Atomic stock + qty in the DB (online orders change the same stock concurrently).
    // A failure warns rather than aborts: aborting mid-loop would make a retry
    // restock the already-restored variants twice.
    const stockFailures = [];
    for (const bi of billItems || []) {
      const netQty = bi.quantity - (exchangedQtyMap[bi.bill_item_id] || 0);
      if (netQty <= 0) continue;
      const { error } = await supabase.rpc("stock_adjust", {
        p_variant: bi.variantid,
        p_delta: netQty,
        p_reason: "bill_cancel",
        p_ref: String(billId),
      });
      if (error) {
        console.error("Stock restore failed for", bi.variantid, error);
        stockFailures.push(bi.variantid);
      }
    }
    if (stockFailures.length > 0) {
      toast({
        title: "Stock sync warning",
        description: `Stock could not be restored for ${stockFailures.length} variant(s). Please recheck inventory.`,
        variant: "destructive",
      });
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
    const { error } = await supabase.rpc("store_credit_adjust", {
      p_customer: customerid,
      p_delta: refund,
      p_reason: "bill_cancel_refund",
      p_ref: String(billId),
    });
    if (error) throw new Error("Store credit refund failed: " + error.message);
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
      logActivity({ action: "update", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Cancelled draft bill #${bill.bill_number || "(no number)"} for ${customerName(bill.customers)} — ${money(bill.totalamount)}` });
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
      logActivity({ action: "update", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Voided bill #${bill.bill_number || "(no number)"} — ${money(bill.totalamount)}` });
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
      logActivity({ action: "update", entityType: "bill", entityId: cancelBill.bill_number || cancelBill.billid, summary: `Voided bill #${cancelBill.bill_number || "(no number)"} for ${customerName(cancelBill.customers)} (cash refund) — ${money(cancelBill.totalamount)}` });
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
    const customerDisplayName = cancelBill.customers
      ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name || ""}`.trim()
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
      const { error: creditErr } = await supabase.rpc("store_credit_adjust", {
        p_customer: customerid,
        p_delta: refundAmount,
        p_reason: "bill_cancel_credit",
        p_ref: String(billId),
      });
      if (creditErr) throw new Error("Store credit could not be added: " + creditErr.message);
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
          customerName: customerDisplayName,
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

      logActivity({ action: "update", entityType: "bill", entityId: cancelBill.bill_number || cancelBill.billid, summary: `Voided bill #${cancelBill.bill_number || "(no number)"} for ${customerName(cancelBill.customers)} (store credit ${money(refundAmount)})` });
      toast({
        title: `Bill #${billId} cancelled. ${formatINR(refundAmount, 2)} store credit added to ${customerDisplayName || "customer"}'s account.`,
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

    // Optimistic removal
    setBills((prev) => prev.filter((b) => b.billid !== billId));

    try {
      await restoreStockForBill(billId);

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

      logActivity({ action: "delete", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Deleted bill #${bill.bill_number || "(no number)"} for ${customerName(bill.customers)} — ${money(bill.totalamount)}` });
      toast({ title: `Bill #${billId} deleted` });
    } catch (e) {
      // Revert optimistic removal
      setBills((prev) => {
        if (prev.some((b) => b.billid === billId)) return prev;
        return [...prev, bill].sort((a, b) => new Date(b.orderdate || 0) - new Date(a.orderdate || 0));
      });
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  };


  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search by bill #, customer name, or phone"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="max-w-xs"
        />
        <select
          value={typeFilter}
          onChange={(e) => { setPage(1); setTypeFilter(e.target.value); }}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="all">All types</option>
          <option value="bos">Bill of Supply</option>
          <option value="invoice">Tax Invoice</option>
        </select>
      </div>

      {/* Table */}
      <div className="border rounded-2xl overflow-x-auto">
        {loading && bills.length === 0 ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <table className={`w-full text-sm ${loading ? "opacity-60" : ""}`}>
            <thead className="bg-muted">
              <tr>
                <th
                  className="p-2 text-left cursor-pointer select-none hover:bg-muted-foreground/10"
                  onClick={() => handleSortClick("bill_number")}
                >
                  Bill ID{sortIndicator("bill_number")}
                </th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left hidden xl:table-cell">Type</th>
                <th
                  className="p-2 text-left cursor-pointer select-none hover:bg-muted-foreground/10"
                  onClick={() => handleSortClick("orderdate")}
                >
                  Date{sortIndicator("orderdate")}
                </th>
                <th
                  className="p-2 text-right cursor-pointer select-none hover:bg-muted-foreground/10"
                  onClick={() => handleSortClick("totalamount")}
                >
                  Total{sortIndicator("totalamount")}
                </th>
                <th
                  className="p-2 text-right cursor-pointer select-none hover:bg-muted-foreground/10 hidden xl:table-cell"
                  onClick={() => handleSortClick("gst_total")}
                >
                  GST{sortIndicator("gst_total")}
                </th>
                <th
                  className="p-2 text-right cursor-pointer select-none hover:bg-muted-foreground/10 hidden lg:table-cell"
                  onClick={() => handleSortClick("discount_total")}
                >
                  Discount{sortIndicator("discount_total")}
                </th>
                <th className="p-2 text-right">Amount Received</th>
                <th
                  className="p-2 text-center cursor-pointer select-none hover:bg-muted-foreground/10"
                  onClick={() => handleSortClick("paymentstatus")}
                >
                  Status{sortIndicator("paymentstatus")}
                </th>
                <th className="p-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.billid} className="border-t">
                  <td className="p-2 whitespace-nowrap">
                    <div>{b.bill_number || b.billid}</div>
                    {b.bill_number && (
                      <div className="text-xs text-muted-foreground">
                        ID: {b.billid}
                      </div>
                    )}
                    {/* The Type column is hidden on narrow windows. */}
                    <div className="text-xs text-muted-foreground xl:hidden">
                      {b.document_type === "invoice" ? "Invoice" : "BoS"}
                    </div>
                  </td>
                  <td className="p-2">
                    {b.customers
                      ? `${b.customers.first_name} ${b.customers.last_name || ""}`.trim()
                      : "—"}
                  </td>
                  <td className="p-2 hidden xl:table-cell">
                    <Badge variant={b.document_type === "invoice" ? "default" : "secondary"}>
                      {b.document_type === "invoice" ? "Tax Invoice" : "Bill of Supply"}
                    </Badge>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {b.orderdate ? formatDate(b.orderdate) : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {formatINR((b.totalamount || 0) + (b.discount_total || 0), 2)}
                  </td>
                  <td className="p-2 text-right hidden xl:table-cell">
                    {formatINR(b.gst_total || 0, 2)}
                  </td>
                  <td className="p-2 text-right hidden lg:table-cell">
                    {b.discount_total != null && b.discount_total > 0
                      ? formatINR(b.discount_total, 2)
                      : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {b.amount_received != null
                      ? formatINR(b.amount_received, 2)
                      : "—"}
                    {Number(b.exchange_credit_used) > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        Exchange: {formatINR(b.exchange_credit_used, 0)}
                      </div>
                    )}
                    {Number(b.store_credit_used) > 0 && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        Credit: {formatINR(b.store_credit_used, 0)}
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    <Badge
                      variant={
                        b.paymentstatus === "finalized"
                          ? "default"
                          : b.paymentstatus === "cancelled"
                            ? "destructive"
                            : "secondary"
                      }
                      className={
                        b.paymentstatus === "partial"
                          ? "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100"
                          : undefined
                      }
                    >
                      {b.paymentstatus === "finalized"
                        ? "Finalized"
                        : b.paymentstatus === "cancelled"
                          ? "Cancelled"
                          : b.paymentstatus === "partial"
                            ? "Pending Payment"
                            : "Draft"}
                    </Badge>
                    {b.paymentstatus === "partial" && b.net_amount != null && b.payment_amount != null && (
                      <div className="text-xs text-red-600 mt-0.5 tabular-nums">
                        Due: {formatINR(Math.max(0, Number(b.net_amount) - Number(b.payment_amount)), 2)}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {/* Two short rows on narrow windows, one row when there is room. */}
                    <div className="grid grid-cols-3 gap-0.5 justify-items-center xl:flex xl:gap-1 xl:justify-center">
                      {isWebsiteMethod(b.salesmethods) ? (
                        <span
                          className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground"
                          title="Online order bill: manage it in Online Orders"
                        >
                          <Globe className="h-4 w-4" />
                        </span>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => onEdit(b.billid)}
                          title="Edit bill"
                          aria-label="Edit bill"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!b.pdf_url}
                        className={
                          !b.pdf_url ? "opacity-40 cursor-not-allowed" : ""
                        }
                        title={
                          b.pdf_url
                            ? "View invoice PDF"
                            : "PDF available after finalize"
                        }
                        aria-label="View invoice PDF"
                        onClick={() => handleViewPdf(b)}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!b.pdf_url || sendingSms.has(b.billid)}
                        className={!b.pdf_url ? "opacity-40 cursor-not-allowed" : ""}
                        title={b.pdf_url ? "Send bill via SMS" : "Finalize bill first to send via SMS"}
                        aria-label="Send bill via SMS"
                        onClick={() => handleSendSms(b)}
                      >
                        {sendingSms.has(b.billid)
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <MessageSquare className="h-4 w-4" />}
                      </Button>
                      {b.finalized && (
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={regeningBills.has(b.billid)}
                          title="Regenerate PDF"
                          aria-label="Regenerate PDF"
                          onClick={() => handleRegenPdf(b)}
                        >
                          {regeningBills.has(b.billid) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      {b.paymentstatus !== "cancelled" && !isWebsiteMethod(b.salesmethods) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="hover:text-destructive"
                          title={
                            b.finalized
                              ? "Cancel finalized bill"
                              : "Cancel bill"
                          }
                          aria-label="Cancel bill"
                          onClick={() => openCancelFlow(b)}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      )}
                      {!isWebsiteMethod(b.salesmethods) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title={
                            b.finalized
                              ? "Delete finalized bill (restores stock)"
                              : "Delete draft"
                          }
                          aria-label="Delete bill"
                          onClick={() => handleDelete(b)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr>
                  <td
                    colSpan={10}
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
        <div className="text-sm text-muted-foreground">Page {page}</div>
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
            disabled={!hasNextPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Dialog 1 — Step 1 confirm */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmOpen(false);
            setCancelBill(null);
          }
        }}
      >
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>
              {cancelBill?.finalized
                ? `Cancel Finalized Bill #${cancelBill?.billid}?`
                : `Cancel Draft Bill #${cancelBill?.billid}?`}
            </DialogTitle>
            <DialogDescription>
              This will restore stock for all items. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {cancelBill && (
            <div className="space-y-2 text-sm">
              <div>
                <span className="font-semibold">Customer:</span>{" "}
                {cancelBill.customers
                  ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name || ""}`.trim()
                  : "—"}
              </div>
              <div>
                <span className="font-semibold">Date:</span>{" "}
                {cancelBill.orderdate ? formatDate(cancelBill.orderdate) : "—"}
              </div>
              <div>
                <span className="font-semibold">Grand Total:</span>{" "}
                {formatINR(cancelBill.totalamount ?? 0, 2)}
              </div>
              <div>
                <span className="font-semibold">Status:</span>{" "}
                {cancelBill.finalized ? "Finalized" : "Draft"}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="ghost"
              disabled={cancelSaving}
              onClick={() => {
                setConfirmOpen(false);
                setCancelBill(null);
              }}
            >
              Keep Bill
            </Button>
            <Button
              variant={cancelBill?.finalized ? "default" : "destructive"}
              disabled={cancelSaving}
              onClick={handleStep1Continue}
            >
              {cancelSaving
                ? "Working..."
                : cancelBill?.finalized
                  ? "Continue"
                  : "Cancel Draft"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog 2 — Step 2 resolution */}
      <Dialog
        open={resolveOpen}
        onOpenChange={(o) => {
          if (!o) {
            setResolveOpen(false);
            setCancelBill(null);
          }
        }}
      >
        <DialogContent className="bg-white max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>How would you like to resolve this?</DialogTitle>
            <DialogDescription>
              {cancelBill &&
                `Bill #${cancelBill.billid} (${formatINR(cancelBill.totalamount ?? 0, 2)}) was finalized. Choose a resolution for the customer.`}
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
                <div className="text-xs text-muted-foreground">
                  Reverses customer spend. No store credit issued.
                </div>
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
                  {formatINR(cancelBill?.totalamount ?? 0, 2)} added to{" "}
                  {cancelBill?.customers
                    ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name || ""}`.trim()
                    : "customer"}
                  's account. A return receipt will be printed.
                </div>
              </div>
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button
              variant="ghost"
              disabled={cancelSaving}
              onClick={() => {
                setResolveOpen(false);
                setCancelBill(null);
              }}
            >
              Go Back
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {billPdfOffscreen}

      {/* Off-screen ReturnReceiptView for PDF capture */}
      {receiptBill && (
        <div
          style={{
            position: "fixed",
            top: "-9999px",
            left: "-9999px",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
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
