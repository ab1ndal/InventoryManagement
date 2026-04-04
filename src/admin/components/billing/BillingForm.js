import { useState, useMemo, useEffect } from "react";
import { computeBillTotals } from "./billUtils";
import { buildBillItemsPayload } from "./stockHelpers";
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



  const computed = useMemo(
    () => computeBillTotals(items, selectedCodes, allDiscounts),
    [items, selectedCodes, allDiscounts]
  );

  // BILL-01 + STOCK-01: New draft save | BILL-02 + STOCK-02: Draft update (Plan 03)
  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      if (billId) {
        // TODO: Plan 03 — draft update with stock reconciliation (BILL-02 + STOCK-02)
        toast({ title: "Draft update not yet implemented", variant: "destructive" });
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
