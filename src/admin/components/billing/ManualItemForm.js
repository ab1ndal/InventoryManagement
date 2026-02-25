import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Button } from "../../../components/ui/button";
import { v4 as uuidv4 } from "uuid";

export default function ManualItemForm({ onAdd, initialVal }) {
  const [category, setCategory] = useState(
    initialVal?.category || initialVal?.manual_category || ""
  );
  const [name, setName] = useState(
    initialVal?.product_name || initialVal?.manual_name || ""
  );
  const [code, setCode] = useState(initialVal?.manual_code || "");
  const [mrp, setMrp] = useState(initialVal?.mrp || 0);
  const [qty, setQty] = useState(initialVal?.quantity || 1);

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label>Category</Label>
          <Input
            placeholder="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>Product Name</Label>
          <Input
            placeholder="Product name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>Code</Label>
          <Input
            placeholder="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>MRP (₹)</Label>
          <Input
            type="number"
            placeholder="MRP"
            value={mrp}
            onChange={(e) => setMrp(e.target.value)}
          />
        </div>
        <div className="grid gap-1">
          <Label>Quantity</Label>
          <Input
            type="number"
            min={1}
            placeholder="Qty"
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
          />
        </div>
      </div>
      <Button
        onClick={() =>
          onAdd({
            _id: uuidv4(),
            source: "manual",
            manual_category: category || null,
            manual_name: name || null,
            manual_code: code || null,
            category: category || null,
            product_name: name || null,
            quantity: qty,
            mrp: Number(mrp || 0),
            quickDiscountPct: initialVal?.quickDiscountPct ?? 0,
            gstRate: initialVal?.gstRate ?? 18,
            alteration_charge: initialVal?.alteration_charge ?? 0,
          })
        }
      >
        {initialVal ? "Update" : "Add"}
      </Button>
    </div>
  );
}
