import { useState } from "react";
import { Input } from "../../../components/ui/input";
import { Button } from "../../../components/ui/button";

export default function ManualItemForm({ onAdd }) {
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mrp, setMrp] = useState(0);
  const [qty, setQty] = useState(1);

  return (
    <div className="grid gap-2">
      <Input
        placeholder="Category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <Input
        placeholder="Product name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        placeholder="Code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <Input
        type="number"
        placeholder="MRP"
        value={mrp}
        onChange={(e) => setMrp(e.target.value)}
      />
      <Input
        type="number"
        min={1}
        placeholder="Qty"
        value={qty}
        onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
      />
      <Button
        onClick={() =>
          onAdd({
            manual_category: category,
            manual_name: name,
            manual_code: code,
            mrp: Number(mrp),
            quantity: qty,
          })
        }
      >
        Add
      </Button>
    </div>
  );
}
