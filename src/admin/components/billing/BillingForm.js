import { useState, useMemo, useEffect } from "react";
import { computeBillTotals } from "./billUtils";
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
    if (open) {
      loadDiscounts();
    } else {
      setItems([]);
      setSelectedCodes([]);
      setSelectedCustomerId(null);
      setNotes("");
      setAllDiscounts([]);
      setIsSaving(false);
      setEditingItem(null);
    }
  }, [open]);

  const loadDiscounts = async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase
      .from("discounts")
      .select("id, code, type, value, max_discount, category, once_per_customer, exclusive, auto_apply, min_total, start_date, end_date, active")
      .eq("active", true);
    if (error) {
      console.error("Error loading discounts:", error.message);
      toast({ title: "Could not load discounts", description: error.message, variant: "destructive" });
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

  const computed = useMemo(
    () => computeBillTotals(items, selectedCodes, allDiscounts),
    [items, selectedCodes, allDiscounts]
  );

  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      // TODO: save to supabase
      toast({ title: "Draft saved" });
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
