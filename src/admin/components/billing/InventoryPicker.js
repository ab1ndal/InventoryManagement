import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Button } from "../../../components/ui/button";
import { supabase } from "../../../lib/supabaseClient";

export default function InventoryPicker({ onPicked }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    const run = async () => {
      if (!query) {
        setResults([]);
        return;
      }
      const { data } = await supabase
        .from("products")
        .select("productid, description, code, category, mrp")
        .or(`code.ilike.%${query}%,description.ilike.%${query}%`);
      setResults(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!selected) return;
    supabase
      .from("productsizecolors")
      .select("variantid, color, size, quantity")
      .eq("productid", selected.productid)
      .then(({ data }) => setVariants(data || []));
  }, [selected]);

  return (
    <div className="grid gap-2">
      <Input
        placeholder="Search products..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {results.map((p) => (
        <div
          key={p.productid}
          onClick={() => setSelected(p)}
          className="p-2 border rounded cursor-pointer"
        >
          {p.description} • {p.code} • ₹{p.mrp}
        </div>
      ))}
      {selected && (
        <>
          <Select onValueChange={setVariantId} value={variantId || undefined}>
            <SelectTrigger>
              <SelectValue placeholder="Select variant" />
            </SelectTrigger>
            <SelectContent>
              {variants.map((v) => (
                <SelectItem key={v.variantid} value={v.variantid}>
                  {v.color} / {v.size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(parseInt(e.target.value || "1", 10))}
          />
          <Button
            onClick={() =>
              onPicked({ ...selected, variantid: variantId, quantity: qty })
            }
          >
            Add
          </Button>
        </>
      )}
    </div>
  );
}
