// src/admin/pages/ExchangePage.js
import React, { useState, useMemo, useRef } from "react";
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
  computeMaxReturnQty,
  calcItemCredit,
  buildReturnedItemsWithCredit,
} from "../components/billing/exchangeHelpers";

export default function ExchangePage() {
  const navigate = useNavigate();
  const receiptRef = useRef(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);      // array of bills
  const [loadedBill, setLoadedBill] = useState(null);          // selected bill with customer
  const [billItems, setBillItems] = useState([]);              // returnable items with maxReturnQty
  const [returnQtyMap, setReturnQtyMap] = useState({});        // bill_item_id -> returnQty
  const [reasonMap, setReasonMap] = useState({});              // bill_item_id -> reason text
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [receiptReadyItems, setReceiptReadyItems] = useState([]); // for hidden PDF render
  const [receiptReadyCredit, setReceiptReadyCredit] = useState(0);

  // --- search ---
  async function handleSearch(e) {
    e?.preventDefault?.();
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchResults([]);
    try {
      // Step 1: exact/partial bill_number match (finalized only — D-02)
      const { data: byNum, error: e1 } = await supabase
        .from("bills")
        .select("billid, bill_number, orderdate, customerid, totalamount, customers(first_name, last_name)")
        .eq("paymentstatus", "finalized")
        .ilike("bill_number", `%${q}%`)
        .order("bill_number", { ascending: false })
        .limit(20);
      if (e1) throw e1;

      // Step 2: if no bill_number hits, search by customer name (two-step to avoid PostgREST inner-join ambiguity)
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
    try {
      const { data: items, error: e1 } = await supabase
        .from("bill_items")
        .select("bill_item_id, billid, product_name, product_code, size, color, category, quantity, mrp, discount_total, alteration_charge, variantid, manual_item_id")
        .eq("billid", bill.billid);
      if (e1) throw e1;

      const billItemIds = (items || []).map(bi => bi.bill_item_id);
      let existing = [];
      if (billItemIds.length > 0) {
        const { data: ex } = await supabase
          .from("exchanges")
          .select("original_bill_item_id, quantity")
          .in("original_bill_item_id", billItemIds);
        existing = ex || [];
      }
      const returnable = computeMaxReturnQty(items || [], existing);
      if (returnable.length === 0) {
        toast.info("All items on this bill have already been returned.");
        return;
      }
      setLoadedBill(bill);
      setBillItems(returnable);
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

  // --- computed totals for preview ---
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
      // 1. Restock inventory items (D-06)
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

      // 2. Restock manual items (D-05) — requires migration_14 applied
      for (const ri of selected) {
        if (!ri.variantid && ri.manual_item_id) {
          const { data: mi, error: me } = await supabase
            .from("manual_items")
            .select("stock")
            .eq("manual_item_id", ri.manual_item_id)
            .single();
          if (me) {
            console.warn(`Manual item lookup failed (column may be missing): ${me.message}`);
            continue; // graceful degradation if migration_14 not applied
          }
          if (mi) {
            await supabase
              .from("manual_items")
              .update({ stock: Number(mi.stock || 0) + Number(ri.returnQty) })
              .eq("manual_item_id", ri.manual_item_id);
          }
        }
      }

      // 3. Insert exchanges rows (D-07)
      const exchangeRows = selected.map(ri => ({
        original_bill_item_id: ri.bill_item_id,
        quantity: ri.returnQty,
        reason: reasonMap[ri.bill_item_id]?.trim() || null,
        customerid: loadedBill.customerid || null,
        credit_amount: ri.creditAmount,
        voucher_id: null, // D-07
      }));
      const { error: exErr } = await supabase.from("exchanges").insert(exchangeRows);
      if (exErr) throw new Error(`Exchange record failed: ${exErr.message}`);

      // 4. Update customers.store_credit (D-09, D-10) — skip if no customer
      if (loadedBill.customerid) {
        const { data: custRow, error: ce } = await supabase
          .from("customers")
          .select("store_credit")
          .eq("customerid", loadedBill.customerid)
          .single();
        if (ce) throw new Error(`Customer lookup failed: ${ce.message}`);
        if (custRow) {
          const newBalance = Number(custRow.store_credit ?? 0) + totalCredit;
          const { error: ue } = await supabase
            .from("customers")
            .update({ store_credit: newBalance })
            .eq("customerid", loadedBill.customerid);
          if (ue) throw new Error(`Store credit update failed: ${ue.message}`);
        }
      }

      // 5. Generate PDF (D-13) — hidden receipt render + html2canvas
      flushSync(() => {
        setReceiptReadyItems(selected);
        setReceiptReadyCredit(totalCredit);
      });
      // small wait for the hidden DOM to paint
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

      toast.success(`Exchange recorded. Credit ₹${totalCredit.toFixed(2)} added.`);

      // 6. Navigate to /admin/bills with route state (D-14, D-17) — consumed in Plan 03
      navigate("/admin/bills", {
        state: {
          openNewBill: true,
          exchangeCredit: {
            amount: totalCredit,
            label: `Return Credit — Bill #${loadedBill.bill_number || loadedBill.billid}`,
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
              <Button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
              >
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
                      <span className="font-semibold">
                        #{b.bill_number || b.billid}
                      </span>
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
              Return items from Bill #
              {loadedBill.bill_number || loadedBill.billid}
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
                const credit = calcItemCredit(bi, rq);
                return (
                  <div
                    key={bi.bill_item_id}
                    className="grid grid-cols-12 gap-2 px-3 py-2 items-center border-b last:border-0 text-sm"
                  >
                    <div className="col-span-4">
                      <div className="font-medium">
                        {bi.product_name || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[bi.size, bi.color, bi.variantid ? null : "manual"]
                          .filter(Boolean)
                          .join(" / ")}
                      </div>
                    </div>
                    <div className="col-span-1 text-right tabular-nums">
                      ₹{Number(bi.mrp || 0).toFixed(0)}
                    </div>
                    <div className="col-span-1 text-right tabular-nums">
                      {bi.maxReturnQty}
                    </div>
                    <div className="col-span-2 text-right">
                      <Input
                        type="number"
                        min={0}
                        max={bi.maxReturnQty}
                        value={returnQtyMap[bi.bill_item_id] ?? 0}
                        onChange={(e) =>
                          handleQtyChange(
                            bi.bill_item_id,
                            e.target.value,
                            bi.maxReturnQty,
                          )
                        }
                        className="text-right"
                      />
                    </div>
                    <div className="col-span-3">
                      <Input
                        type="text"
                        placeholder="e.g., size mismatch"
                        value={reasonMap[bi.bill_item_id] ?? ""}
                        onChange={(e) =>
                          handleReasonChange(bi.bill_item_id, e.target.value)
                        }
                      />
                    </div>
                    <div className="col-span-1 text-right tabular-nums">
                      ₹{credit.toFixed(2)}
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
              <Button variant="outline" onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={() => setConfirmOpen(true)}
              >
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
            <DialogDescription>
              Review returned items. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <strong>Bill:</strong> #
              {loadedBill?.bill_number || loadedBill?.billid}
            </div>
            <div>
              <strong>Customer:</strong>{" "}
              {loadedBill?.customers
                ? `${loadedBill.customers.first_name} ${loadedBill.customers.last_name || ""}`.trim()
                : "Missing Customer"}
            </div>
            <div className="border rounded p-2 max-h-60 overflow-y-auto">
              {selected.map((ri) => (
                <div
                  key={ri.bill_item_id}
                  className="flex justify-between py-1 border-b last:border-0"
                >
                  <span>
                    {ri.product_name} × {ri.returnQty}
                  </span>
                  <span className="tabular-nums">
                    ₹{Number(ri.creditAmount).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
            <div className="text-right font-semibold text-base pt-2">
              Total Credit: ₹{totalCredit.toFixed(2)}
            </div>
            {!loadedBill?.customerid && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                No customer on this bill — stock will be restored and PDF will
                print, but no store credit can be saved.
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant="ghost"
              disabled={confirmSaving}
              onClick={() => setConfirmOpen(false)}
            >
              Keep Editing
            </Button>
            <Button disabled={confirmSaving} onClick={handleConfirm}>
              {confirmSaving ? "Processing..." : "Confirm Exchange"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
