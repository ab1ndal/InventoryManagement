import { useState, useMemo } from "react";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Label } from "../../../components/ui/label";
import { Textarea } from "../../../components/ui/textarea";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";

import CustomerSelector from "./CustomerSelector";
import ItemTable from "./ItemTable";
import AddItemDialog from "./AddItemDialog";
import DiscountSelector from "./DiscountSelector";
import Summary from "./Summary";
import Notes from "./Notes";

export default function BillingForm() {
  const { billId: billIdParam } = useParams();
  const billId = billIdParam === "new" ? null : Number(billIdParam);

  const { toast } = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [notes, setNotes] = useState("");
  const [allDiscounts, setAllDiscounts] = useState([]);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  const computed = useMemo(() => {
    // TODO: import and use computeBillTotals logic
    return {
      itemsSubtotal: 0,
      itemLevelDiscountTotal: 0,
      overallDiscount: 0,
      taxableTotal: 0,
      gstTotal: 0,
      grandTotal: 0,
    };
  }, [items, selectedCodes, allDiscounts]);

  const handleSaveDraft = async () => {
    setIsSaving(true);
    try {
      // TODO: save to supabase
      toast({ title: "Draft saved" });
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
    } catch (e) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
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
            <ItemTable items={items} setItems={setItems} />
          </section>

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
            <Button variant="outline" onClick={() => navigate("/admin/bills")}>
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
    </div>
  );
}
