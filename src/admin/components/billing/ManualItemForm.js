import { useState } from "react";
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
import { v4 as uuidv4 } from "uuid";

export default function ManualItemForm({ onAdd, initialVal }) {
  const [category, setCategory] = useState(
    initialVal?.category || initialVal?.manual_category || ""
  );
  const [name, setName] = useState(
    initialVal?.product_name || initialVal?.manual_name || ""
  );
  const [code, setCode] = useState(initialVal?.manual_code || "");
  const [size, setSize] = useState(initialVal?.size || "");
  const [color, setColor] = useState(initialVal?.color || "");
  const [qty, setQty] = useState(initialVal?.quantity || 1);
  const [mrp, setMrp] = useState(initialVal?.mrp || 0);
  const [alterationCharge, setAlterationCharge] = useState(
    initialVal?.alteration_charge || 0
  );
  const [gstRate, setGstRate] = useState(
    String(initialVal?.gstRate ?? 18)
  );
  const [costPrice, setCostPrice] = useState(initialVal?.cost_price || 0);

  function handleSubmit() {
    onAdd({
      _id: uuidv4(),
      source: "manual",
      manual_category: category || null,
      manual_name: name || null,
      manual_code: code || null,
      category: category || null,
      product_name: name || null,
      size: size || null,
      color: color || null,
      quantity: qty,
      mrp: Number(mrp || 0),
      quickDiscountPct: initialVal?.quickDiscountPct ?? 0,
      gstRate: Number(gstRate),
      alteration_charge: Number(alterationCharge) || 0,
      cost_price: Number(costPrice) || 0,
    });
  }

  return (
    <div className="grid gap-4">
      {/* Item Details section */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Item Details
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="grid gap-1">
            <Label>Category</Label>
            <Input
              placeholder="e.g. Shirt"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
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
            <Label>Product Code</Label>
            <Input
              placeholder="Optional"
              value={code}
              onChange={(e) => setCode(e.target.value)}
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
          <div className="grid gap-1 col-span-2">
            <Label>Color</Label>
            <Input
              placeholder="e.g. Navy Blue"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Pricing section */}
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
              placeholder="1"
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
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
          <div className="grid gap-1 col-span-2">
            <Label>Z Code (Rs)</Label>
            <Input
              type="number"
              placeholder="Cost price"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Internal only — not shown to customer
            </p>
          </div>
        </div>
      </div>

      <Button onClick={handleSubmit} disabled={!name.trim()}>
        {initialVal ? "Update Item" : "Add Item"}
      </Button>
    </div>
  );
}
