import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { supabase } from "../../../lib/supabaseClient";
import { useToast } from "../../../components/hooks/use-toast";
import { v4 as uuidv4 } from "uuid";

// Encode numeric cost price to Z-code: 1234 → "ZABCD"
function encodePriceToZCode(price) {
  const map = { 1: "A", 2: "B", 3: "C", 4: "D", 5: "E", 6: "F", 7: "G", 8: "H", 9: "I", 0: "Z" };
  const digits = Number(price || 0).toString().split("");
  return "Z" + digits.map((d) => map[d] ?? "Z").join("");
}

// Decode Z-code to numeric cost price: "ZABCD" → 1234
function decodeZCode(str) {
  const s = String(str || "").toUpperCase().trim();
  if (!s.startsWith("Z") || s.length < 2) return Number(s) || 0;
  const rev = { A: "1", B: "2", C: "3", D: "4", E: "5", F: "6", G: "7", H: "8", I: "9", Z: "0" };
  return Number(s.slice(1).split("").map((ch) => rev[ch] ?? "0").join("")) || 0;
}

function getBCXPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `BCX${yy}`;
}

async function getNextManualItemId() {
  const prefix = getBCXPrefix();
  const { data: maxNum, error } = await supabase.rpc("get_max_manual_item_suffix", {
    p_prefix: prefix,
  });
  if (error) throw new Error("Could not generate item ID: " + error.message);

  const yearDigits = prefix.slice(3); // "25"
  const maxStr = maxNum ? String(maxNum) : "";
  const suffixNow =
    maxStr.startsWith(yearDigits)
      ? parseInt(maxStr.slice(yearDigits.length) || "0", 10)
      : 0;

  const nextSuffix = suffixNow + 1;
  return `${prefix}${String(nextSuffix).padStart(3, "0")}`;
}

export default function ManualItemForm({ onAdd, initialVal }) {
  const { toast } = useToast();
  const isEditing = !!initialVal;
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);

  // Form fields — mirroring product entry
  const [categoryId, setCategoryId] = useState(initialVal?.categoryid || "");
  const [name, setName] = useState(initialVal?.product_name || initialVal?.manual_name || "");
  const [size, setSize] = useState(initialVal?.size || "");
  const [color, setColor] = useState(initialVal?.color || "");
  const [qty, setQty] = useState(initialVal?.quantity || 1);
  const [mrp, setMrp] = useState(initialVal?.mrp || "");
  const [discountPct, setDiscountPct] = useState(initialVal?.quickDiscountPct ?? 0);
  const [alterationCharge, setAlterationCharge] = useState(initialVal?.alteration_charge || "");
  const [gstRate, setGstRate] = useState(String(initialVal?.gstRate ?? 18));
  // Z Code: show encoded if we have a stored cost_price, otherwise blank
  const [zCode, setZCode] = useState(
    initialVal?.cost_price ? encodePriceToZCode(initialVal.cost_price) : ""
  );

  useEffect(() => {
    supabase
      .from("categories")
      .select("categoryid, name")
      .order("name")
      .then(({ data }) => {
        const list = data || [];
        setCategories(list);
        // When editing, resolve categoryid from the stored category name
        // (bill_items stores name, not categoryid)
        if (!categoryId && initialVal?.category) {
          const match = list.find((c) => c.name === initialVal.category);
          if (match) setCategoryId(match.categoryid);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const purchasePrice = decodeZCode(zCode);
      const categoryName = categories.find((c) => c.categoryid === categoryId)?.name || initialVal?.category || null;

      let manualItemId;
      if (isEditing) {
        // Editing an existing bill item — reuse the existing BCX ID, don't insert again
        manualItemId = initialVal.productid || initialVal.manual_code || null;
      } else {
        // New manual item — generate BCX ID and insert into manual_items
        manualItemId = await getNextManualItemId();
        const { error } = await supabase.from("manual_items").insert({
          manual_item_id: manualItemId,
          name: name.trim(),
          categoryid: categoryId || null,
          size: size || null,
          color: color || null,
          purchase_price: purchasePrice,
          mrp: Number(mrp) || 0,
        });
        if (error) throw new Error(error.message);
        toast({ title: `Manual item added — ${manualItemId}` });
      }

      onAdd({
        _id: uuidv4(),
        source: "manual",
        productid: manualItemId,
        product_name: name.trim(),
        manual_name: name.trim(),
        manual_code: manualItemId,
        categoryid: categoryId || null,
        category: categoryName,
        manual_category: categoryName,
        size: size || null,
        color: color || null,
        quantity: Number(qty) || 1,
        mrp: Number(mrp) || 0,
        quickDiscountPct: Number(discountPct) || 0,
        gstRate: Number(gstRate),
        alteration_charge: Number(alterationCharge) || 0,
        cost_price: purchasePrice,
      });
      // Retain values — do not reset state
    } catch (e) {
      toast({ title: "Failed to add item", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* Item Details */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Item Details
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.categoryid} value={c.categoryid}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>
              Product Name <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="Item name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>Size</Label>
            <Input
              placeholder="e.g. L, 42"
              value={size}
              onChange={(e) => setSize(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>Color</Label>
            <Input
              placeholder="e.g. Navy Blue"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Pricing
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label>Qty</Label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>MRP (Rs)</Label>
            <Input
              type="number"
              placeholder="0.00"
              value={mrp}
              onChange={(e) => setMrp(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>Discount %</Label>
            <Input
              type="number"
              min={0}
              max={100}
              placeholder="0"
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>Alteration Charge (Rs)</Label>
            <Input
              type="number"
              placeholder="0.00"
              value={alterationCharge}
              onChange={(e) => setAlterationCharge(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>GST Rate %</Label>
            <Select value={gstRate} onValueChange={setGstRate}>
              <SelectTrigger>
                <SelectValue placeholder="Select GST rate" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0%</SelectItem>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="12">12%</SelectItem>
                <SelectItem value="18">18%</SelectItem>
                <SelectItem value="28">28%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>Z Code (Purchase Price)</Label>
            <Input
              placeholder="e.g. ZABCD"
              value={zCode}
              onChange={(e) => setZCode(e.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">Internal only — not shown to customer</p>
          </div>
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={!name.trim() || saving}>
        {saving ? "Adding..." : "Add Item"}
      </Button>
    </div>
  );
}
