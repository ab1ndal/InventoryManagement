import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import CustomDropdown from "../../../components/CustomDropdown";
import { supabase } from "../../../lib/supabaseClient";
import { addVariantStock } from "../../lib/variants";
import { variantLabel } from "../../../utility/activitySummary";

/**
 * For a bill whose piece is on the shelf but not in the inventory: add stock to a size and
 * colour the product has, or add a new one, without leaving the bill. Writes to the inventory
 * straight away, apart from the bill's Save. Sizes and colours are the inventory's lists; a new
 * code is still added in the inventory editor.
 */
export default function AddVariantStock({ product, variants, onAdded }) {
  const [open, setOpen] = useState(false);
  const [sizes, setSizes] = useState([]);
  const [colors, setColors] = useState([]);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const isMeter = product.unit_type === "meter";

  useEffect(() => {
    if (!open) return undefined;
    let stale = false;
    Promise.all([
      supabase.from("sizes").select("code, label").order("sort_order"),
      supabase.from("colors").select("code").order("code"),
    ]).then(([s, c]) => {
      if (stale) return;
      if (s.error || c.error) {
        toast.error("Could not load sizes and colours", { description: (s.error || c.error).message });
        return;
      }
      setSizes(s.data || []);
      setColors(c.data || []);
    });
    return () => {
      stale = true;
    };
  }, [open]);

  if (!open) {
    return (
      <Button type="button" variant="link" className="h-auto justify-start p-0 text-xs" onClick={() => setOpen(true)}>
        Size or colour missing, or out of stock? Add stock
      </Button>
    );
  }

  const existing = variants.find((v) => v.size === size && v.color === color);
  const unit = isMeter ? "m" : "pcs";

  const save = async () => {
    setSaving(true);
    try {
      const result = await addVariantStock(supabase, { product, size, color, quantity: qty });
      toast.success(
        result.created
          ? `Added ${variantLabel(size, color)} to the inventory`
          : `${variantLabel(size, color)} stock is now ${result.stock} ${unit}`,
      );
      setOpen(false);
      setSize("");
      setColor("");
      setQty(1);
      onAdded(result.variantid);
    } catch (err) {
      toast.error("Stock not added", { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">Adds to the inventory now, even if this bill is not saved.</p>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem] gap-2">
        <CustomDropdown
          value={size}
          onChange={setSize}
          options={sizes.map((s) => ({ value: s.code, label: s.label }))}
          placeholder="Size"
        />
        <CustomDropdown
          value={color}
          onChange={setColor}
          options={colors.map((c) => ({ value: c.code, label: c.code }))}
          placeholder="Colour"
        />
        <Input
          type="number"
          aria-label={`Stock to add (${unit})`}
          min={0}
          step={isMeter ? "0.001" : "1"}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </div>
      {size && color && (
        <p className="text-xs">
          {existing
            ? `Adds ${qty || 0} ${unit} to ${variantLabel(size, color)} (stock now ${existing.stock})`
            : `New variant ${variantLabel(size, color)} with ${qty || 0} ${unit}`}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={saving || !size || !color} onClick={save}>
          {saving ? "Adding…" : "Add stock"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
