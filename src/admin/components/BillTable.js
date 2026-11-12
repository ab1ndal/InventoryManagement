// src/admin/components/BillTable.js
import React, { useEffect, useState, useRef } from "react";
import { flushSync } from "react-dom";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Loader2, Pencil, FileText, Trash2, Ban, RefreshCw, MessageCircle, Globe } from "lucide-react";
import { isWebsiteMethod, receivedAmount } from "./billing/paymentHelpers";
import { round2 } from "./billing/billUtils";
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

// Order and labels match the Status badge in each row.
const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "partial", label: "Pending Payment" },
  { value: "finalized", label: "Finalized" },
  { value: "cancelled", label: "Cancelled" },
];

// A cancelled draft has already had its stock put back, so deleting it would put it back again.
const isDeletableDraft = (bill) => !bill.finalized && bill.paymentstatus !== "cancelled";

// stock_reduced is null on bills saved before it existed: nobody recorded whether they moved stock,
// so whoever cancels one decides.
// bill_cancel refusals, in words staff can act on.
const CANCEL_ERRORS = {
  BILL_ALREADY_CANCELLED: "This bill is already cancelled. Refresh the list.",
  BILL_STALE: "This bill changed since the list loaded. Refresh and try again.",
  BILL_ONLINE: "Cancel website orders from the Orders screen.",
};

// Cancelled bills are locked: a sale is redone as a new bill.
const isEditableBill = (bill) => bill.paymentstatus !== "cancelled";

export default function BillTable({ onEdit }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bills, setBills] = useState([]);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({ search: "" });
  const [typeFilter, setTypeFilter] = useState("all"); // 'all' | 'bos' | 'invoice'
  const [statusFilter, setStatusFilter] = useState([]); // empty = every status
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuRef = useRef(null);
  const [sort, setSort] = useState({ key: "bill_number", dir: "desc" });
  const [cancelBill, setCancelBill] = useState(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  // Read once when the resolve dialog opens; the dialog text and the credit written both use it.
  const [resolveFigures, setResolveFigures] = useState({ received: 0, exchangeGiven: 0, refund: 0, storeCreditUsed: 0 });
  const cancelKeyRef = useRef(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [restoreOlderBill, setRestoreOlderBill] = useState(true);
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
          "billid, bill_number, customerid, customers(first_name, last_name), orders(contact_name, contact_phone), orderdate, totalamount, gst_total, discount_total, payment_amount, net_amount, store_credit_used, exchange_credit_used, paymentstatus, finalized, stock_reduced, pdf_url, document_type, salesmethods(methodname), bill_payments(amount)"
        )
        .order(SORTABLE_COLUMNS[sort.key] || DEFAULT_SORT.key, {
          ascending: sort.dir === "asc",
          nullsFirst: false,
        })
        .range((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE); // fetch 51 to detect next page

      if (typeFilter !== "all") query = query.eq("document_type", typeFilter);
      if (statusFilter.length > 0) query = query.in("paymentstatus", statusFilter);

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

        // Amount Received = total cash collected for the bill (see receivedAmount).
        setBills(
          pageBills.map((b) => ({
            ...withOrderContact(b),
            amount_received: receivedAmount(b),
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
  }, [page, filters, sort, toast, typeFilter, statusFilter]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const close = (e) => {
      if (!statusMenuRef.current?.contains(e.target)) setStatusMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [statusMenuOpen]);

  // Kept in STATUS_OPTIONS order so the button label and the query read the same way every time.
  const toggleStatus = (value) => {
    setPage(1);
    setStatusFilter((prev) =>
      STATUS_OPTIONS.map((o) => o.value).filter((v) => (v === value) !== prev.includes(v))
    );
  };

  const statusButtonLabel =
    statusFilter.length === 0
      ? "All"
      : STATUS_OPTIONS.filter((o) => statusFilter.includes(o.value)).map((o) => o.label).join(", ");

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
    cancelKeyRef.current = null;
    setRestoreOlderBill(true);
    setCancelBill(bill);
    setConfirmOpen(true);
  };

  // Atomic stock + qty in the DB (online orders change the same stock concurrently).
  // A failure warns rather than aborts: aborting mid-loop would make a retry
  // restock the already-restored variants twice.
  const restockItems = async (billId, billItems, exchangedQtyMap) => {
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

  // The whole cancel (stock, store credit, exchanges, voucher, discount usage, status) is one
  // bill_cancel transaction. The key lives as long as the dialog, so pressing again after an
  // unknown outcome replays the first cancel instead of doing it twice.
  const runCancel = async (bill, mode) => {
    if (!cancelKeyRef.current) cancelKeyRef.current = crypto.randomUUID();
    const { data, error } = await supabase.rpc("bill_cancel", {
      p_key: cancelKeyRef.current,
      p_billid: bill.billid,
      p_mode: mode,
      p_options: {
        expect: { finalized: Boolean(bill.finalized), paymentstatus: bill.paymentstatus },
        restore_older_stock: restoreOlderBill,
      },
    });
    if (error) throw new Error(CANCEL_ERRORS[error.message] || error.message);
    cancelKeyRef.current = null;
    setBills((prev) =>
      prev.map((b) => (b.billid === bill.billid ? { ...b, paymentstatus: "cancelled" } : b))
    );
    return data;
  };

  const stockOutcome = (result) =>
    result.stock.length > 0 ? "Stock restored." : "Stock not changed.";

  const closeCancel = () => {
    cancelKeyRef.current = null;
    setConfirmOpen(false);
    setResolveOpen(false);
    setCancelBill(null);
  };

  const handleCancelDraft = async (bill) => {
    setCancelSaving(true);
    try {
      const result = await runCancel(bill, "draft");
      logActivity({ action: "update", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Cancelled draft bill #${bill.bill_number || "(no number)"} for ${customerName(bill.customers)} — ${money(bill.totalamount)}` });
      toast({ title: `Bill #${bill.billid} cancelled. ${stockOutcome(result)}` });
      closeCancel();
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleCancelFinalizedNoCustomer = async (bill) => {
    setCancelSaving(true);
    try {
      const result = await runCancel(bill, "no_customer");
      logActivity({ action: "update", entityType: "bill", entityId: bill.bill_number || bill.billid, summary: `Voided bill #${bill.bill_number || "(no number)"} — ${money(bill.totalamount)}` });
      toast({ title: `Bill #${bill.billid} cancelled. ${stockOutcome(result)} No customer on record.` });
      closeCancel();
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleResolveReturnPayment = async () => {
    if (!cancelBill) return;
    setCancelSaving(true);
    try {
      const result = await runCancel(cancelBill, "return_payment");
      logActivity({ action: "update", entityType: "bill", entityId: cancelBill.bill_number || cancelBill.billid, summary: `Voided bill #${cancelBill.bill_number || "(no number)"} for ${customerName(cancelBill.customers)} (cash refund ${money(result.refund)}) — ${money(cancelBill.totalamount)}` });
      toast({ title: `Bill #${cancelBill.billid} cancelled. Hand back ${formatINR(result.refund, 2)}. ${stockOutcome(result)}` });
      closeCancel();
    } catch (e) {
      toast({ title: "Cancel failed", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  const handleResolveIssueStoreCredit = async () => {
    if (!cancelBill) return;
    const { billid: billId, orderdate } = cancelBill;
    const customerDisplayName = cancelBill.customers
      ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name || ""}`.trim()
      : "";
    setCancelSaving(true);
    try {
      const result = await runCancel(cancelBill, "store_credit");
      const creditAmount = Number(result.credit_added);

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
          creditAmount,
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

      logActivity({ action: "update", entityType: "bill", entityId: cancelBill.bill_number || cancelBill.billid, summary: `Voided bill #${cancelBill.bill_number || "(no number)"} for ${customerName(cancelBill.customers)} (store credit ${money(creditAmount)})` });
      toast({
        title: `Bill #${billId} cancelled. ${formatINR(creditAmount, 2)} store credit added to ${customerDisplayName || "customer"}'s account.`,
      });
      closeCancel();
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
    openResolveDialog(cancelBill);
  };

  // Display only: bill_cancel works the refund out again under its lock, with the same rule.
  const openResolveDialog = async (bill) => {
    setCancelSaving(true);
    try {
      const { data, error } = await supabase
        .from("bills")
        .select("payment_amount, store_credit_used, bill_payments(amount), bill_items(exchanges(credit_amount))")
        .eq("billid", bill.billid)
        .single();
      if (error) throw error;
      const received = receivedAmount(data) ?? 0;
      const exchangeGiven = round2(
        (data.bill_items || []).flatMap((bi) => bi.exchanges || []).reduce((s, e) => s + Number(e.credit_amount), 0)
      );
      setResolveFigures({
        received,
        exchangeGiven,
        refund: Math.max(0, round2(received - exchangeGiven)),
        storeCreditUsed: Number(data.store_credit_used ?? 0),
      });
      setConfirmOpen(false);
      setResolveOpen(true);
    } catch (e) {
      toast({ title: "Could not read what the customer paid", description: e.message, variant: "destructive" });
    } finally {
      setCancelSaving(false);
    }
  };

  // Drafts only. A finalized bill is kept as a record and goes through Cancel.
  const handleDelete = async (bill) => {
    const { billid: billId } = bill;
    // Only a bill known to have moved no stock skips the restore: an older draft cannot ask here.
    const givesStockBack = bill.stock_reduced !== false;
    if (!window.confirm(`Delete draft Bill #${bill.bill_number || billId} for ${customerName(bill.customers)}? ${givesStockBack ? "This will restore stock." : "Stock will not change."}`)) return;

    // Optimistic removal
    setBills((prev) => prev.filter((b) => b.billid !== billId));

    try {
      // This list can be out of date: the bill may have been finalized or cancelled since it loaded.
      const { data: current, error: readErr } = await supabase
        .from("bills")
        .select("finalized, paymentstatus")
        .eq("billid", billId)
        .single();
      if (readErr) throw readErr;
      if (!isDeletableDraft(current)) {
        throw new Error("This bill is no longer a draft. Refresh the page to see it.");
      }

      // Stock follows the rows this call actually removed, and a row can only be removed once,
      // so trying again after a failure further down cannot restore the same stock twice.
      const { data: removedItems, error: itemsErr } = await supabase
        .from("bill_items")
        .delete()
        .eq("billid", billId)
        .select("bill_item_id, variantid, quantity");
      if (itemsErr) throw itemsErr;
      // Only finalized bills can be exchanged, so a draft has no exchanged quantity to allow for.
      if (givesStockBack) {
        await restockItems(billId, (removedItems || []).filter((bi) => bi.variantid), {});
      }

      const { error: spErr } = await supabase.from("bill_salespersons").delete().eq("billid", billId);
      if (spErr) throw spErr;
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
        <div className="relative" ref={statusMenuRef}>
          <button
            type="button"
            onClick={() => setStatusMenuOpen((o) => !o)}
            aria-expanded={statusMenuOpen}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            Status: {statusButtonLabel} ▾
          </button>
          {statusMenuOpen && (
            <div className="absolute left-0 z-20 mt-1 w-48 rounded border bg-white p-2 shadow-md space-y-1">
              {STATUS_OPTIONS.map((o) => (
                <label key={o.value} className="flex items-center gap-2 text-sm cursor-pointer px-1 py-0.5 rounded hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(o.value)}
                    onChange={() => toggleStatus(o.value)}
                    className="h-4 w-4 cursor-pointer"
                  />
                  {o.label}
                </label>
              ))}
              <button
                type="button"
                disabled={statusFilter.length === 0}
                onClick={() => { setPage(1); setStatusFilter([]); }}
                className="w-full text-left text-xs text-primary px-1 pt-1 border-t disabled:text-muted-foreground"
              >
                Clear
              </button>
            </div>
          )}
        </div>
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
                    {formatINR(b.totalamount || 0, 2)}
                    {b.discount_total > 0 && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {formatINR(b.discount_total, 0)} off
                      </div>
                    )}
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
                      ) : !isEditableBill(b) ? (
                        <span
                          className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground"
                          title="Cancelled bill: create a new bill instead"
                          aria-label="Cancelled bill, cannot be edited"
                        >
                          <Pencil className="h-4 w-4 opacity-30" />
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
                        title={b.pdf_url ? "Send bill on WhatsApp" : "Finalize bill first to send on WhatsApp"}
                        aria-label="Send bill on WhatsApp"
                        onClick={() => handleSendSms(b)}
                      >
                        {sendingSms.has(b.billid)
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <MessageCircle className="h-4 w-4" />}
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
                      {isDeletableDraft(b) && !isWebsiteMethod(b.salesmethods) && (
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Delete draft"
                          aria-label="Delete draft"
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
          if (!o) closeCancel();
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
              {cancelBill?.stock_reduced === false
                ? "This bill did not reduce stock, so stock will not change. This cannot be undone."
                : cancelBill?.stock_reduced == null
                  ? "This cannot be undone."
                  : "This will restore stock for all items. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          {cancelBill && cancelBill.stock_reduced == null && (
            <div className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                id="restore-older-bill"
                checked={restoreOlderBill}
                onChange={(e) => setRestoreOlderBill(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer"
              />
              <label htmlFor="restore-older-bill" className="cursor-pointer">
                Put this bill's items back in stock. This is an older bill, so the website does not know whether it
                reduced stock. Untick if it did not.
              </label>
            </div>
          )}
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
              onClick={closeCancel}
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
          if (!o) closeCancel();
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
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Paid by the customer</span>
              <span>{formatINR(resolveFigures.received, 2)}</span>
            </div>
            {resolveFigures.exchangeGiven > 0 && (
              <div className="flex justify-between">
                <span>Less exchange credit already given</span>
                <span>−{formatINR(resolveFigures.exchangeGiven, 2)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold">
              <span>To refund</span>
              <span>{formatINR(resolveFigures.refund, 2)}</span>
            </div>
          </div>
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
                  {resolveFigures.refund > 0
                    ? `Hand back ${formatINR(resolveFigures.refund, 2)}. No store credit issued.`
                    : "Nothing to hand back. No store credit issued."}
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
                  {resolveFigures.refund > 0
                    ? `${formatINR(resolveFigures.refund, 2)} will be added to `
                    : resolveFigures.received > 0
                      ? "Exchange credit already covers what was paid, so no store credit will be added to "
                      : "Nothing was paid on this bill, so no store credit will be added to "}
                  {cancelBill?.customers
                    ? `${cancelBill.customers.first_name} ${cancelBill.customers.last_name || ""}`.trim()
                    : "customer"}
                  's account.
                  {resolveFigures.storeCreditUsed > 0 &&
                    ` The ${formatINR(resolveFigures.storeCreditUsed, 2)} of store credit used on this bill is also returned.`}
                  {" "}A return receipt will be printed. If this looks wrong, adjust the customer's credit by hand.
                </div>
              </div>
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button
              variant="ghost"
              disabled={cancelSaving}
              onClick={closeCancel}
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
