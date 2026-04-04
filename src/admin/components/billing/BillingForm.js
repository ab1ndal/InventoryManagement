import { useState, useMemo, useEffect } from "react";
import { computeBillTotals } from "./billUtils";
import { buildBillItemsPayload, computeStockDelta, backCalcDiscountPct } from "./stockHelpers";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Label } from "../../../components/ui/label";
//import { Textarea } from "../../../components/ui/textarea";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";

import CustomerSelector from "./CustomerSelector";
import ItemTable from "./ItemTable";
import AddItemDialog from "./AddItemDialog";
import DiscountSelector from "./DiscountSelector";
import Summary from "./Summary";
import Notes from "./Notes";
import {
  Dialog,
  //  DialogTrigger,
  DialogDescription,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

export default function BillingForm({ billId, open, onOpenChange, onSubmit }) {
  const { toast } = useToast();
  const [items, setItems] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [notes, setNotes] = useState("");
  const [allDiscounts, setAllDiscounts] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    if (!open) {
      setItems([]);
      setSelectedCodes([]);
      setSelectedCustomerId(null);
      setNotes("");
      setAllDiscounts([]);
      setIsSaving(false);
      setEditingItem(null);
      return;
    }

    const loadDiscounts = async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("discounts")
        .select(
          "id, code, type, value, max_discount, category, once_per_customer, exclusive, auto_apply, min_total, start_date, end_date, active",
        )
        .eq("active", true);
      if (error) {
        console.error("Error loading discounts:", error.message);
        toast({
          title: "Could not load discounts",
          description: error.message,
          variant: "destructive",
        });
        return;
      }
      const valid = (data || []).filter((d) => {
        if (d.start_date && d.start_date > today) return false;
        if (d.end_date && d.end_date < today) return false;
        return true;
      });
      setAllDiscounts(valid);
      const autoCodes = valid.filter((d) => d.auto_apply).map((d) => d.code);
      setSelectedCodes(autoCodes);
    };

    loadDiscounts();
  }, [open, toast]);

  useEffect(() => {
    if (!open || !billId) return;
    const loadBill = async () => {
      try {
        // Fetch bill header (customerid + notes only — applied_codes fetched separately for resilience)
        const { data: bill, error: billErr } = await supabase
          .from("bills")
          .select("customerid, notes")
          .eq("billid", billId)
          .single();
        if (billErr) throw billErr;

        // Fetch applied_codes separately — column may not exist if migration not yet run
        const { data: codesRow } = await supabase
          .from("bills")
          .select("applied_codes")
          .eq("billid", billId)
          .single();

        // Fetch bill items
        const { data: billItems, error: itemsErr } = await supabase
          .from("bill_items")
          .select("*")
          .eq("billid", billId);
        if (itemsErr) throw itemsErr;

        // Set form state from bill
        setSelectedCustomerId(bill.customerid || null);
        setNotes(bill.notes || "");

        // Override auto-apply codes with saved applied_codes (D-02 + Pitfall 4)
        const savedCodes = codesRow?.applied_codes;
        if (savedCodes && savedCodes.length > 0) {
          setSelectedCodes(savedCodes);
        }

        // Reconstruct items — product_code in DB stores the BC-format productid for inventory items
        setItems((billItems || []).map(bi => ({
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
        })));
      } catch (e) {
        toast({ title: "Error loading bill", description: e.message, variant: "destructive" });
      }
    };
    loadBill();
  }, [open, billId, toast]);

  const computed = useMemo(
    () => computeBillTotals(items, selectedCodes, allDiscounts),
    [items, selectedCodes, allDiscounts]
  );

  // BILL-01 + STOCK-01: New draft save | BILL-02 + STOCK-02: Draft update (Plan 03)
  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      if (billId) {
        // BILL-02 + STOCK-02: Draft update with stock reconciliation

        // Step A: Validate items exist
        if (items.length === 0) {
          toast({ title: "Error", description: "Add at least one item", variant: "destructive" });
          return;
        }

        // Step B: Fetch existing bill_items for stock delta computation
        const { data: existingItems, error: fetchErr } = await supabase
          .from("bill_items")
          .select("variantid, quantity")
          .eq("billid", billId)
          .not("variantid", "is", null);
        if (fetchErr) throw new Error("Could not fetch existing items: " + fetchErr.message);

        const newInventoryItems = items.filter(it => it.variantid);

        // Step C: Compute stock delta
        const deltaMap = computeStockDelta(existingItems || [], newInventoryItems);

        // Step D: Fetch current stock for all affected variants (union of old + new variantids)
        const allVariantIds = Object.keys(deltaMap);
        let stockMap = {};
        if (allVariantIds.length > 0) {
          const { data: stockData, error: stockErr } = await supabase
            .from("productsizecolors")
            .select("variantid, stock, size, color")
            .in("variantid", allVariantIds);
          if (stockErr) throw new Error("Could not verify stock: " + stockErr.message);
          stockMap = Object.fromEntries(stockData.map(r => [r.variantid, r]));
        }

        // Step E: Validate stock — for items being added or increased, check available stock
        // Available = current_stock + old_qty_restored (delta for that variant from old items)
        // We need: final stock = current_stock + delta >= 0
        const stockErrors = [];
        for (const [vid, delta] of Object.entries(deltaMap)) {
          const currentStock = stockMap[vid]?.stock ?? 0;
          const finalStock = currentStock + delta;
          if (finalStock < 0) {
            const item = newInventoryItems.find(it => it.variantid === vid);
            const name = item?.product_name || vid;
            const size = stockMap[vid]?.size || "";
            const color = stockMap[vid]?.color || "";
            stockErrors.push(`${name} (${size}/${color}): would result in ${finalStock} stock`);
          }
        }
        if (stockErrors.length > 0) {
          toast({ title: "Insufficient stock", description: stockErrors.join("\n"), variant: "destructive" });
          return;
        }

        // Step F: Delete old bill_items
        const { error: delErr } = await supabase.from("bill_items").delete().eq("billid", billId);
        if (delErr) throw new Error("Failed to remove old items: " + delErr.message);

        // Step G: Insert new bill_items
        const billItemsPayload = buildBillItemsPayload(billId, items);
        const { error: insErr } = await supabase.from("bill_items").insert(billItemsPayload);
        if (insErr) throw new Error("Failed to save updated items: " + insErr.message);

        // Step H: Update bills row
        const { error: updErr } = await supabase
          .from("bills")
          .update({
            customerid: selectedCustomerId || null,
            notes: notes || null,
            totalamount: computed.grandTotal,
            gst_total: computed.gstTotal,
            discount_total: computed.itemLevelDiscountTotal + computed.overallDiscount,
            taxable_total: computed.taxableTotal,
            applied_codes: selectedCodes,
          })
          .eq("billid", billId);
        if (updErr) throw new Error("Failed to update bill: " + updErr.message);

        // Step I: Apply stock deltas
        for (const [vid, delta] of Object.entries(deltaMap)) {
          if (delta === 0) continue;
          const currentStock = stockMap[vid]?.stock ?? 0;
          const { error: stockUpdateErr } = await supabase
            .from("productsizecolors")
            .update({ stock: currentStock + delta })
            .eq("variantid", vid);
          if (stockUpdateErr) {
            console.error("Stock update failed for", vid, stockUpdateErr);
          }
        }

        // Step J: Success
        toast({ title: `Draft saved — Bill #${billId}` });
        onOpenChange?.(false);
        onSubmit?.();
        return;
      }

      // New draft path
      if (items.length === 0) {
        toast({ title: "Error", description: "Add at least one item", variant: "destructive" });
        return;
      }

      // Step B - Stock validation per D-01
      const inventoryItems = items.filter(it => it.variantid);
      let stockMap = {};
      if (inventoryItems.length > 0) {
        const variantIds = inventoryItems.map(it => it.variantid);
        const { data: stockData, error: stockErr } = await supabase
          .from("productsizecolors")
          .select("variantid, stock, size, color")
          .in("variantid", variantIds);
        if (stockErr) throw new Error("Could not verify stock: " + stockErr.message);

        stockMap = Object.fromEntries(stockData.map(r => [r.variantid, r]));
        const outOfStock = inventoryItems.filter(it => {
          const available = stockMap[it.variantid]?.stock ?? 0;
          return it.quantity > available;
        });
        if (outOfStock.length > 0) {
          const details = outOfStock.map(it => {
            const avail = stockMap[it.variantid]?.stock ?? 0;
            return `${it.product_name} (${stockMap[it.variantid]?.size || ''}/${stockMap[it.variantid]?.color || ''}): requested ${it.quantity}, available ${avail}`;
          }).join("\n");
          toast({ title: "Insufficient stock", description: details, variant: "destructive" });
          return;
        }
      }

      // Step C - Insert bills row
      const { data: bill, error: billError } = await supabase
        .from("bills")
        .insert({
          customerid: selectedCustomerId || null,
          notes: notes || null,
          totalamount: computed.grandTotal,
          gst_total: computed.gstTotal,
          discount_total: computed.itemLevelDiscountTotal + computed.overallDiscount,
          taxable_total: computed.taxableTotal,
          paymentstatus: "draft",
          finalized: false,
          applied_codes: selectedCodes,
        })
        .select("billid")
        .single();
      if (billError) throw new Error("Failed to save bill: " + billError.message);

      // Step D - Insert bill_items
      const billItemsPayload = buildBillItemsPayload(bill.billid, items);
      const { error: itemsError } = await supabase.from("bill_items").insert(billItemsPayload);
      if (itemsError) {
        // Best-effort cleanup of dangling bills row (Pitfall 6)
        await supabase.from("bills").delete().eq("billid", bill.billid);
        throw new Error("Failed to save bill items: " + itemsError.message);
      }

      // Step E - Decrement stock for inventory items
      for (const it of inventoryItems) {
        const currentStock = stockMap[it.variantid]?.stock ?? 0;
        const { error: stockUpdateErr } = await supabase
          .from("productsizecolors")
          .update({ stock: currentStock - it.quantity })
          .eq("variantid", it.variantid);
        if (stockUpdateErr) {
          console.error("Stock update failed for", it.variantid, stockUpdateErr);
        }
      }

      // Step F - Success
      toast({ title: `Draft saved — Bill #${bill.billid}` });
      onOpenChange?.(false);
      onSubmit?.();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFinalize = async () => {
    setIsSaving(true);
    try {
      // TODO: finalize bill in supabase
      toast({ title: "Bill finalized" });
      onOpenChange?.(false);
      onSubmit?.();
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full max-h-[90vh] overflow-y-auto bg-white">
        <DialogHeader>
          <DialogTitle>
            {billId ? `Edit Bill #${billId}` : "New Bill"}
          </DialogTitle>
          <DialogDescription>
            {billId ? "Edit existing bill details" : "Create a new bill"}
          </DialogDescription>
        </DialogHeader>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Billing</CardTitle>
            <div className="text-sm text-muted-foreground">
              {billId ? `Bill ID: ${billId}` : "New Bill"}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Customer */}
            <section className="grid gap-3">
              <Label>Customer</Label>
              <CustomerSelector
                selectedCustomerId={selectedCustomerId}
                setSelectedCustomerId={setSelectedCustomerId}
              />
            </section>

            {/* Items */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Items</Label>
                <AddItemDialog
                  onAdd={(item) => setItems((prev) => [...prev, item])}
                />
              </div>
              <ItemTable
                items={items}
                setItems={setItems}
                onEdit={(id) => setEditingItem(items.find((it) => it._id === id) ?? null)}
              />
            </section>

            {/* Edit item dialog — opened programmatically from the pencil icon */}
            {editingItem && (
              <AddItemDialog
                key={editingItem._id}
                open={!!editingItem}
                onOpenChange={(o) => { if (!o) setEditingItem(null); }}
                editItem={editingItem}
                onUpdate={(updated) => {
                  setItems((prev) =>
                    prev.map((it) => (it._id === updated._id ? updated : it))
                  );
                  setEditingItem(null);
                }}
              />
            )}

            {/* Discounts */}
            <section className="space-y-2">
              <Label>Overall Discounts</Label>
              <DiscountSelector
                discounts={allDiscounts}
                selectedCodes={selectedCodes}
                onToggle={(code) =>
                  setSelectedCodes((prev) =>
                    prev.includes(code)
                      ? prev.filter((c) => c !== code)
                      : [...prev, code]
                  )
                }
              />
            </section>

            {/* Notes */}
            <Notes notes={notes} setNotes={setNotes} />

            {/* Summary */}
            <Summary computed={computed} />

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange?.(false)}>
                Cancel
              </Button>
              <Button disabled={isSaving} onClick={handleSaveDraft}>
                {isSaving ? "Saving..." : "Save Draft"}
              </Button>
              <Button disabled={isSaving} onClick={handleFinalize}>
                {isSaving ? "Saving..." : "Finalize"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
