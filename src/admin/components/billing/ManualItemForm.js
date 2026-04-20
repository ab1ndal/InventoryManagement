import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Button } from "../../../components/ui/button";
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

  // Form fields
  const [categoryId, setCategoryId] = useState(initialVal?.categoryid || "");
  const [name, setName] = useState(initialVal?.product_name || initialVal?.manual_name || "");
  const [size, setSize] = useState(initialVal?.size || "");
  const [color, setColor] = useState(initialVal?.color || "");
  const [qty, setQty] = useState(initialVal?.quantity || 1);
  const [mrp, setMrp] = useState(initialVal?.mrp || "");
  const [discountPct, setDiscountPct] = useState(initialVal?.quickDiscountPct ?? 0);
  const [alterationCharge, setAlterationCharge] = useState(initialVal?.alteration_charge || "");
  const [stitchType, setStitchType] = useState(initialVal?.stitchType || 'unstitched');
  const [gstRate, setGstRate] = useState(String(initialVal?.gstRate ?? 5));
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
        if (!categoryId && initialVal?.category) {
          const match = list.find((c) => c.name === initialVal.category);
          if (match) setCategoryId(match.categoryid);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-compute GST from stitchType + MRP + discount
  useEffect(() => {
    const pricePerPiece = Number(mrp || 0) * (1 - Number(discountPct || 0) / 100);
    const autoGst = stitchType === 'stitched' && pricePerPiece > 2500 ? 18 : 5;
    setGstRate(String(autoGst));
  }, [stitchType, mrp, discountPct]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const purchasePrice = decodeZCode(zCode);
      const categoryName = categories.find((c) => c.categoryid === categoryId)?.name || initialVal?.category || null;

      let manualItemId;
      if (isEditing) {
        manualItemId = initialVal.productid || initialVal.manual_code || null;
      } else {
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
        stitchType,
      });
    } catch (e) {
      toast({ title: "Failed to add item", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      {/* Stitched / Unstitched toggle */}
      <div className="grid gap-1">
        <Label>Item Type</Label>
        <div className="flex rounded-md border overflow-hidden w-fit">
          <button
            type="button"
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${stitchType === 'unstitched' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            onClick={() => setStitchType('unstitched')}
          >
            Unstitched
          </button>
          <button
            type="button"
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${stitchType === 'stitched' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}`}
            onClick={() => setStitchType('stitched')}
          >
            Stitched
          </button>
        </div>
      </div>

      {/* Item Details */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Item Details
        </p>
        <div className="grid grid-cols-2 gap-2">
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
            <Label>Category (optional)</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— none —</option>
              {categories.map((c) => (
                <option key={c.categoryid} value={c.categoryid}>{c.name}</option>
              ))}
            </select>
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
              max={50}
              placeholder="0"
              value={discountPct}
              onFocus={() => { if (Number(discountPct) === 0) setDiscountPct(""); }}
              onChange={(e) => setDiscountPct(e.target.value)}
              onBlur={() => {
                const num = Math.min(50, Math.max(0, Number(discountPct) || 0));
                setDiscountPct(num);
              }}
            />
          </div>
          <div className="grid gap-1">
            <Label>Alteration Charge <span className="text-xs text-muted-foreground">(incl. 5% GST)</span></Label>
            <Input
              type="number"
              placeholder="0.00"
              value={alterationCharge}
              onChange={(e) => setAlterationCharge(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label>GST Rate (auto)</Label>
            <div className="flex items-center h-9 px-3 rounded-md border bg-muted text-sm font-medium">
              {gstRate}%
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                {stitchType === 'unstitched' ? 'unstitched' : (Number(gstRate) === 18 ? 'stitched >₹2500' : 'stitched ≤₹2500')}
              </span>
            </div>
          </div>
          <div className="grid gap-1">
            <Label>Z Code (Purchase Price)</Label>
            <Input
              placeholder="e.g. ZABCD"
              value={zCode}
              onChange={(e) => setZCode(e.target.value.toUpperCase())}
            />
            <p className="text-xs text-muted-foreground">
              Internal only — not shown to customer
            </p>
          </div>
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={!name.trim() || saving}>
        {saving ? "Adding..." : "Add Item"}
      </Button>
    </div>
  );
}
