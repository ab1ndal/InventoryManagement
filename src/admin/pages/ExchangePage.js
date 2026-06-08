// src/admin/pages/ExchangePage.js
import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import ReturnReceiptView from "../components/billing/ReturnReceiptView";
import { generateInvoicePdf } from "../components/billing/generateInvoicePdf";
import {
  buildReturnedQtyMap,
  buildReturnedItemsWithCredit,
  calcItemCredit,
  isExchangeEligible,
  isWithinExchangeWindow,
  daysSinceBill,
  EXCHANGE_WINDOW_DAYS,
} from "../components/billing/exchangeHelpers";

export default function ExchangePage() {
  const navigate = useNavigate();
  const receiptRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [loadedBill, setLoadedBill] = useState(null);
  const [billItems, setBillItems] = useState([]);
  const [returnQtyMap, setReturnQtyMap] = useState({});
  const [reasonMap, setReasonMap] = useState({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [receiptReadyItems, setReceiptReadyItems] = useState([]);
  const [receiptReadyCredit, setReceiptReadyCredit] = useState(0);
  const [pendingCredit, setPendingCredit] = useState(null); // { amount, exchangeIds, customerId, sourceBillNumber, items[] }

  // history
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const HISTORY_PAGE_SIZE = 20;

  const fetchHistory = useCallback(async (page = 0) => {
    setHistoryLoading(true);
    try {
      const from = page * HISTORY_PAGE_SIZE;
      const to = from + HISTORY_PAGE_SIZE - 1;
      const { data, error, count } = await supabase
        .from("exchanges")
        .select(`
          exchangeid, returndate, quantity, credit_amount, new_billid, reason,
          product_name, product_code,
          bill_items(product_name, product_code, variantid, productsizecolors(size, color), bills(bill_number)),
          customers(first_name, last_name),
          new_bill:bills!exchanges_new_billid_fkey(bill_number)
        `, { count: "exact" })
        .order("returndate", { ascending: false })
        .range(from, to);
      if (error) throw error;
      setHistoryTotal(count || 0);

      // Fetch size/color for manual items (no variantid; product_code = manual_item_id)
      const manualCodes = (data || [])
        .map((ex) => ex.bill_items)
        .filter((bi) => bi && !bi.variantid && bi.product_code)
        .map((bi) => bi.product_code);

      let manualMap = {};
      if (manualCodes.length > 0) {
        const { data: manuals } = await supabase
          .from("manual_items")
          .select("manual_item_id, size, color")
          .in("manual_item_id", manualCodes);
        manualMap = Object.fromEntries(
          (manuals || []).map((m) => [m.manual_item_id, { size: m.size, color: m.color }]),
        );
      }

      // Attach size/color to each exchange's bill_item for uniform render
      const enriched = (data || []).map((ex) => {
        const bi = ex.bill_items;
        if (!bi) return ex;
        const sizeColor = bi.variantid
          ? bi.productsizecolors
          : (manualMap[bi.product_code] || null);
        return { ...ex, bill_items: { ...bi, _sizeColor: sizeColor } };
      });

      setHistory(enriched);
    } catch (err) {
      console.error("History fetch failed:", err.message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { fetchHistory(historyPage); }, [fetchHistory, historyPage]);

  // --- search ---
  async function handleSearch(e) {
    e?.preventDefault?.();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchResults([]);
    try {
      const { data: byNum, error: e1 } = await supabase
        .from("bills")
        .select("billid, bill_number, orderdate, customerid, totalamount, customers(first_name, last_name)")
        .eq("paymentstatus", "finalized")
        .ilike("bill_number", `%${q}%`)
        .order("bill_number", { ascending: false })
        .limit(20);
      if (e1) throw e1;

      let byName = [];
      if (!byNum || byNum.length === 0) {
        const { data: custs } = await supabase
          .from("customers")
          .select("customerid")
          .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`)
          .limit(50);
        const ids = (custs || []).map(c => c.customerid);
        if (ids.length > 0) {
          const { data } = await supabase
            .from("bills")
            .select("billid, bill_number, orderdate, customerid, totalamount, customers(first_name, last_name)")
            .eq("paymentstatus", "finalized")
            .in("customerid", ids)
            .order("orderdate", { ascending: false })
            .limit(20);
          byName = data || [];
        }
      }
      setSearchResults(byNum && byNum.length > 0 ? byNum : byName);
      if ((byNum && byNum.length === 0) && byName.length === 0) {
        toast.info("No finalized bills match that search.");
      }
    } catch (err) {
      toast.error("Search failed", { description: err.message });
    } finally {
      setSearchLoading(false);
    }
  }

  // --- load bill ---
  async function handleLoadBill(bill) {
    if (!isWithinExchangeWindow(bill.orderdate)) {
      const days = daysSinceBill(bill.orderdate);
      toast.error("Exchange window closed", {
        description: `Bill #${bill.bill_number || bill.billid} is ${days} days old. Exchanges accepted within ${EXCHANGE_WINDOW_DAYS} days of purchase only.`,
      });
      return;
    }

    try {
      const { data: items, error: e1 } = await supabase
        .from("bill_items")
        .select("bill_item_id, billid, product_name, product_code, category, quantity, mrp, discount_total, alteration_charge, stitch_type, total, variantid")
        .eq("billid", bill.billid);
      if (e1) throw e1;

      const rawItems = items || [];

      // Fetch size/color for inventory items via variantid → productsizecolors
      const inventoryItems = rawItems.filter((bi) => bi.variantid);
      let variantMap = {};
      if (inventoryItems.length > 0) {
        const { data: variants } = await supabase
          .from("productsizecolors")
          .select("variantid, size, color")
          .in("variantid", inventoryItems.map((bi) => bi.variantid));
        variantMap = Object.fromEntries((variants || []).map((v) => [v.variantid, v]));
      }

      // Fetch size/color for manual items via product_code → manual_item_id
      const manualItems = rawItems.filter((bi) => !bi.variantid && bi.product_code);
      let manualSizeMap = {};
      if (manualItems.length > 0) {
        const { data: manuals } = await supabase
          .from("manual_items")
          .select("manual_item_id, size, color")
          .in("manual_item_id", manualItems.map((bi) => bi.product_code));
        manualSizeMap = Object.fromEntries((manuals || []).map((m) => [m.manual_item_id, m]));
      }

      const allItems = rawItems.map((bi) => {
        const sc = bi.variantid
          ? variantMap[bi.variantid]
          : manualSizeMap[bi.product_code];
        return { ...bi, size: sc?.size || null, color: sc?.color || null };
      });

      const eligibleIds = allItems
        .filter(isExchangeEligible)
        .map(item => item.bill_item_id);
      let existing = [];
      if (eligibleIds.length > 0) {
        const { data: ex } = await supabase
          .from("exchanges")
          .select("original_bill_item_id, quantity")
          .in("original_bill_item_id", eligibleIds);
        existing = ex || [];
      }
      const returnedQtyMap = buildReturnedQtyMap(existing);

      const augmented = allItems.map(item => {
        const eligible = isExchangeEligible(item);
        const returnedQty = returnedQtyMap[item.bill_item_id] || 0;
        const maxReturnQty = eligible
          ? Math.max(0, Number(item.quantity || 0) - returnedQty)
          : 0;
        const isExchanged = eligible && returnedQty > 0 && maxReturnQty === 0;
        return { ...item, isEligible: eligible, maxReturnQty, isExchanged };
      });

      if (!augmented.some(item => item.isEligible && item.maxReturnQty > 0)) {
        toast.info("No eligible items remain to exchange on this bill.");
        return;
      }
      setLoadedBill(bill);
      setBillItems(augmented);
      setReturnQtyMap({});
      setReasonMap({});
      setSearchResults([]);
    } catch (err) {
      toast.error("Could not load bill items", { description: err.message });
    }
  }

  function handleQtyChange(bill_item_id, v, max) {
    const n = Math.max(0, Math.min(Number(v) || 0, Number(max) || 0));
    setReturnQtyMap(prev => ({ ...prev, [bill_item_id]: n }));
  }

  function handleReasonChange(bill_item_id, v) {
    setReasonMap(prev => ({ ...prev, [bill_item_id]: v }));
  }

  const selected = useMemo(
    () => buildReturnedItemsWithCredit(billItems, returnQtyMap),
    [billItems, returnQtyMap]
  );
  const totalCredit = useMemo(
    () => selected.reduce((s, it) => s + Number(it.creditAmount || 0), 0),
    [selected]
  );
  const canConfirm = selected.length > 0 && !confirmSaving;

  // --- confirm flow ---
  async function handleConfirm() {
    if (selected.length === 0) return;
    setConfirmSaving(true);
    try {
      // 1. Restock inventory variants
      for (const ri of selected) {
        if (ri.variantid) {
          const { data: variant, error: ve } = await supabase
            .from("productsizecolors")
            .select("stock")
            .eq("variantid", ri.variantid)
            .single();
          if (ve) throw new Error(`Variant lookup failed: ${ve.message}`);
          if (variant) {
            const { error } = await supabase
              .from("productsizecolors")
              .update({ stock: Number(variant.stock || 0) + Number(ri.returnQty) })
              .eq("variantid", ri.variantid);
            if (error) throw new Error(`Inventory restock failed: ${error.message}`);
          }
        }
      }

      // 2. Restock manual items
      for (const ri of selected) {
        if (!ri.variantid && ri.manual_item_id) {
          const { data: mi, error: me } = await supabase
            .from("manual_items")
            .select("stock")
            .eq("manual_item_id", ri.manual_item_id)
            .single();
          if (me) {
            console.warn(`Manual item lookup failed: ${me.message}`);
            continue;
          }
          if (mi) {
            await supabase
              .from("manual_items")
              .update({ stock: Number(mi.stock || 0) + Number(ri.returnQty) })
              .eq("manual_item_id", ri.manual_item_id);
          }
        }
      }

      // 3. Insert exchange rows — capture IDs for linking to the new bill
      const exchangeRows = selected.map(ri => ({
        original_bill_item_id: ri.bill_item_id,
        quantity: ri.returnQty,
        reason: reasonMap[ri.bill_item_id]?.trim() || null,
        customerid: loadedBill.customerid || null,
        credit_amount: ri.creditAmount,
        voucher_id: null,
        // Snapshot so the record survives a later edit of the source bill,
        // which deletes + reinserts bill_items and nulls original_bill_item_id.
        product_name: ri.product_name || null,
        product_code: ri.product_code || null,
      }));
      const { data: insertedExchanges, error: exErr } = await supabase
        .from("exchanges")
        .insert(exchangeRows)
        .select("exchangeid");
      if (exErr) throw new Error(`Exchange record failed: ${exErr.message}`);
      const exchangeIds = (insertedExchanges || []).map(e => e.exchangeid);

      // 4. Print return receipt
      flushSync(() => {
        setReceiptReadyItems(selected);
        setReceiptReadyCredit(totalCredit);
      });
      await new Promise(r => setTimeout(r, 50));
      if (receiptRef.current) {
        try {
          const blob = await generateInvoicePdf(receiptRef.current, "a5");
          const url = URL.createObjectURL(blob);
          window.open(url, "_blank");
        } catch (pdfErr) {
          console.error("PDF generation failed:", pdfErr);
          toast.warning("Exchange saved but PDF failed", { description: pdfErr.message });
        }
      }

      toast.success(`Exchange recorded. ₹${totalCredit.toFixed(2)} credit saved — redeem on any future bill.`);

      fetchHistory();

      // Navigate to bills page; pre-fill exchange credit so new bill can be created immediately
      navigate("/admin/bills", {
        state: {
          openNewBill: true,
          exchangeCredit: {
            amount: totalCredit,
            label: `Exchange Credit — Bill #${loadedBill.bill_number || loadedBill.billid}`,
            sourceBillNumber: loadedBill.bill_number || String(loadedBill.billid),
            items: selected.map(ri => ({
              product_name: ri.product_name,
              returnQty: ri.returnQty,
              creditAmount: ri.creditAmount,
            })),
            exchangeIds,
          },
          prefilledCustomerId: loadedBill.customerid || null,
        },
      });
    } catch (err) {
      console.error(err);
      toast.error("Exchange failed", { description: err.message });
    } finally {
      setConfirmSaving(false);
      setConfirmOpen(false);
    }
  }

  function handleCancel() {
    setLoadedBill(null);
    setBillItems([]);
    setReturnQtyMap({});
    setReasonMap({});
    setConfirmOpen(false);
    setPendingCredit(null);
  }

  // --- render ---
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Exchanges & Returns</h1>

      {!loadedBill && (
        <Card>
          <CardHeader>
            <CardTitle>Find Bill</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="flex gap-2 mb-4">
              <Input
                placeholder="Bill number (e.g., FY26-000001) or customer name"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-md"
              />
              <Button type="submit" disabled={searchLoading || !searchQuery.trim()}>
                {searchLoading ? "Searching..." : "Search"}
              </Button>
            </form>
            {searchResults.length > 0 && (
              <div className="border rounded divide-y">
                {searchResults.map((b) => (
                  <button
                    key={b.billid}
                    onClick={() => handleLoadBill(b)}
                    className="w-full text-left px-4 py-2 hover:bg-gray-50 flex justify-between items-center"
                  >
                    <span>
                      <span className="font-semibold">#{b.bill_number || b.billid}</span>
                      {" — "}
                      {b.customers
                        ? `${b.customers.first_name} ${b.customers.last_name || ""}`.trim()
                        : "Missing Customer"}
                      {" — "}
                      {new Date(b.orderdate).toLocaleDateString("en-IN")}
                    </span>
                    <span className="tabular-nums text-sm text-muted-foreground">
                      ₹{Number(b.totalamount || 0).toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {loadedBill && (
        <Card>
          <CardHeader>
            <CardTitle>
              Return items from Bill #{loadedBill.bill_number || loadedBill.billid}
            </CardTitle>
            <div className="text-sm text-muted-foreground">
              Customer:{" "}
              {loadedBill.customers
                ? `${loadedBill.customers.first_name} ${loadedBill.customers.last_name || ""}`.trim()
                : "Missing Customer"}
              {" · "}Date:{" "}
              {new Date(loadedBill.orderdate).toLocaleDateString("en-IN")}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border rounded">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-semibold bg-gray-50 border-b">
                <div className="col-span-4">Item</div>
                <div className="col-span-1 text-right">MRP</div>
                <div className="col-span-1 text-right">Qty</div>
                <div className="col-span-2 text-right">Return Qty</div>
                <div className="col-span-3">Reason (optional)</div>
                <div className="col-span-1 text-right">Credit</div>
              </div>
              {billItems.map((bi) => {
                const rq = Number(returnQtyMap[bi.bill_item_id] || 0);
                const credit = bi.isEligible ? calcItemCredit(bi, rq) : 0;
                return (
                  <div
                    key={bi.bill_item_id}
                    className={`grid grid-cols-12 gap-2 px-3 py-2 items-center border-b last:border-0 text-sm${
                      (!bi.isEligible || bi.isExchanged) ? " bg-gray-50 opacity-60" : ""
                    }`}
                  >
                    <div className="col-span-4">
                      <div className="font-medium">{bi.product_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {[bi.product_code, bi.size, bi.color, bi.variantid ? null : "manual"]
                          .filter(Boolean)
                          .join(" / ")}
                        {bi.isExchanged && (
                          <span className="ml-1 inline-block rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-700">
                            Exchanged
                          </span>
                        )}
                        {!bi.isEligible && (
                          <span className="ml-1 inline-block rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700">
                            Altered
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-1 text-right tabular-nums">
                      ₹{Number(bi.mrp || 0).toFixed(0)}
                    </div>
                    <div className="col-span-1 text-right tabular-nums">{bi.quantity}</div>
                    <div className="col-span-2 text-right">
                      {bi.isEligible && !bi.isExchanged ? (
                        <Input
                          type="number"
                          min={0}
                          max={bi.maxReturnQty}
                          value={returnQtyMap[bi.bill_item_id] ?? 0}
                          onChange={(e) =>
                            handleQtyChange(bi.bill_item_id, e.target.value, bi.maxReturnQty)
                          }
                          className="text-right"
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="col-span-3">
                      {bi.isEligible && !bi.isExchanged ? (
                        <Input
                          type="text"
                          placeholder="e.g., size mismatch"
                          value={reasonMap[bi.bill_item_id] ?? ""}
                          onChange={(e) => handleReasonChange(bi.bill_item_id, e.target.value)}
                        />
                      ) : bi.isExchanged ? (
                        <span className="text-xs text-muted-foreground">Already exchanged</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not eligible for exchange</span>
                      )}
                    </div>
                    <div className="col-span-1 text-right tabular-nums text-muted-foreground">
                      {bi.isEligible ? `₹${credit.toFixed(2)}` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t">
              <div className="text-sm">
                Items selected: <strong>{selected.length}</strong>
              </div>
              <div className="text-lg font-semibold">
                Total Credit: ₹{totalCredit.toFixed(2)}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancel}>Cancel</Button>
              <Button disabled={!canConfirm} onClick={() => setConfirmOpen(true)}>
                Review & Confirm
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm Exchange</DialogTitle>
            <DialogDescription>Review returned items. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div><strong>Bill:</strong> #{loadedBill?.bill_number || loadedBill?.billid}</div>
            <div>
              <strong>Customer:</strong>{" "}
              {loadedBill?.customers
                ? `${loadedBill.customers.first_name} ${loadedBill.customers.last_name || ""}`.trim()
                : "Missing Customer"}
            </div>
            <div className="border rounded p-2 max-h-60 overflow-y-auto">
              {selected.map((ri) => (
                <div key={ri.bill_item_id} className="flex justify-between py-1 border-b last:border-0">
                  <span>{ri.product_name} × {ri.returnQty}</span>
                  <span className="tabular-nums">₹{Number(ri.creditAmount).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="text-right font-semibold text-base pt-2">
              Total Credit: ₹{totalCredit.toFixed(2)}
            </div>
            {!loadedBill?.customerid && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                No customer on this bill — stock will be restored and PDF will print, but no store credit can be saved.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" disabled={confirmSaving} onClick={() => setConfirmOpen(false)}>
              Keep Editing
            </Button>
            <Button disabled={confirmSaving} onClick={handleConfirm}>
              {confirmSaving ? "Processing..." : "Confirm Exchange"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Post-exchange success banner */}
      {pendingCredit && !loadedBill && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="font-semibold text-green-800">
                  Exchange recorded — ₹{pendingCredit.amount.toFixed(2)} credit saved
                </p>
                <p className="text-sm text-green-700 mt-0.5">
                  Customer can redeem on any future bill, or create one now.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPendingCredit(null)}
                >
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    navigate("/admin/bills", {
                      state: {
                        openNewBill: true,
                        exchangeCredit: {
                          amount: pendingCredit.amount,
                          label: pendingCredit.label,
                          sourceBillNumber: pendingCredit.sourceBillNumber,
                          items: pendingCredit.items,
                          exchangeIds: pendingCredit.exchangeIds,
                        },
                        prefilledCustomerId: pendingCredit.customerId,
                      },
                    })
                  }
                >
                  Create New Bill Now
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent exchange history */}
      {!loadedBill && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Exchanges</CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No exchanges recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs font-semibold text-muted-foreground">
                      <th className="text-left py-2 pr-3">Date</th>
                      <th className="text-left py-2 pr-3">Original Bill</th>
                      <th className="text-left py-2 pr-3">Item</th>
                      <th className="text-left py-2 pr-3">Reason</th>
                      <th className="text-right py-2 pr-3">Qty</th>
                      <th className="text-right py-2 pr-3">Credit</th>
                      <th className="text-left py-2 pr-3">Applied To</th>
                      <th className="text-left py-2">Customer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.map((ex) => {
                      const bi = ex.bill_items;
                      const origBill = bi?.bills?.bill_number;
                      const newBill = ex.new_bill?.bill_number;
                      const cust = ex.customers;
                      return (
                        <tr key={ex.exchangeid} className="hover:bg-gray-50">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {new Date(ex.returndate).toLocaleDateString("en-IN")}
                          </td>
                          <td className="py-2 pr-3 font-medium">
                            {origBill ? `#${origBill}` : "—"}
                          </td>
                          <td className="py-2 pr-3">
                            <div>{bi?.product_name || ex.product_name || "—"}</div>
                            {(bi?.product_code || ex.product_code || bi?._sizeColor?.size || bi?._sizeColor?.color) && (
                              <div className="text-xs text-muted-foreground">
                                {[bi?.product_code || ex.product_code, bi?._sizeColor?.size, bi?._sizeColor?.color]
                                  .filter(Boolean)
                                  .join(" / ")}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">
                            {ex.reason || "—"}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{ex.quantity}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            ₹{Number(ex.credit_amount).toFixed(2)}
                          </td>
                          <td className="py-2 pr-3">
                            {newBill ? (
                              <span className="font-medium">#{newBill}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">Pending</span>
                            )}
                          </td>
                          <td className="py-2">
                            {cust
                              ? `${cust.first_name} ${cust.last_name || ""}`.trim()
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {historyTotal > HISTORY_PAGE_SIZE && (
              <div className="flex items-center justify-between pt-3 text-sm">
                <span className="text-muted-foreground">
                  {historyPage * HISTORY_PAGE_SIZE + 1}–{Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, historyTotal)} of {historyTotal}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage === 0}
                    onClick={() => setHistoryPage(p => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= historyTotal}
                    onClick={() => setHistoryPage(p => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hidden DOM for return receipt PDF */}
      <div
        style={{ position: "fixed", top: "-9999px", left: "-9999px", pointerEvents: "none" }}
        aria-hidden="true"
      >
        <ReturnReceiptView
          ref={receiptRef}
          mode="exchange"
          billId={loadedBill?.bill_number || loadedBill?.billid || "—"}
          originalBillDate={loadedBill?.orderdate}
          customerName={
            loadedBill?.customers
              ? `${loadedBill.customers.first_name} ${loadedBill.customers.last_name || ""}`.trim()
              : "Missing Customer"
          }
          items={receiptReadyItems.map((ri) => ({
            product_name: ri.product_name,
            quantity: ri.returnQty,
            mrp: ri.mrp,
            size: ri.size,
            color: ri.color,
            creditAmount: ri.creditAmount,
          }))}
          creditAmount={receiptReadyCredit}
          issueDate={new Date()}
        />
      </div>
    </div>
  );
}
