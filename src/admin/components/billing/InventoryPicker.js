import { useState, useEffect } from "react";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Button } from "../../../components/ui/button";
import { supabase } from "../../../lib/supabaseClient";
import { v4 as uuidv4 } from "uuid";

export default function InventoryPicker({ onPicked, initialVal }) {
  const [query, setQuery] = useState(initialVal?.product?.productid || "");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(initialVal?.product || null);
  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState(initialVal?.variantid || null);
  const [qty, setQty] = useState(initialVal?.quantity || 1);
  const [error, setError] = useState("");

  const [alterationCharge, setAlterationCharge] = useState(
    initialVal?.alt_charge || 0
  );
  const [gstRate, setGstRate] = useState(initialVal?.gstRate || null);
  const [discount, setDiscount] = useState(initialVal?.discount || 0);

  // Search products only after 6 characters
  useEffect(() => {
    const run = async () => {
      if (query.length < 6) {
        setResults([]);
        return;
      }
      const { data, error } = await supabase
        .from("products")
        .select("productid, categoryid, purchaseprice, retailprice, name")
        .ilike("productid", `%${query}%`)
        .limit(10);
      if (!error) setResults(data || []);
    };
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Load variants for selected product
  useEffect(() => {
    if (!selected) return;
    supabase
      .from("productsizecolors")
      .select("variantid, productid, size, color, stock")
      .eq("productid", selected.productid)
      .then(({ data }) => setVariants(data || []));
  }, [selected]);

  // Validate quantity
  useEffect(() => {
    if (!variantId || !qty) {
      setError("");
      return;
    }
    const chosenVariant = variants.find((v) => v.variantid === variantId);
    if (chosenVariant && qty > chosenVariant.stock) {
      setError(`Only ${chosenVariant.stock} left in stock`);
    } else {
      setError("");
    }
  }, [qty, variantId, variants]);

  useEffect(() => {
    if (!selected) return;

    const basePrice = selected.retailprice || 0;
    const totalBase = basePrice * (1 - discount / 100) + alterationCharge;

    let autoGst = 18;

    // lower GST for Saree / Suit or < 2500
    if (
      selected.categoryid === "SA" ||
      selected.categoryid === "ST" ||
      totalBase < 2500
    ) {
      autoGst = 5;
    }
    setGstRate(autoGst);
  }, [selected, qty, discount, alterationCharge]);

  return (
    <div className="grid gap-4">
      {/* Product search */}
      <div className="grid gap-1">
        <Label>Product ID</Label>
        <Input
          placeholder="Enter Product ID..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* Product ID dropdown */}
      {results.length > 0 && (
        <div className="border rounded bg-white">
          {results.map((p) => (
            <div
              key={p.productid}
              onClick={() => {
                setSelected(p);
                setQuery(p.productid);
                setResults([]);
              }}
              className="p-2 hover:bg-gray-100 cursor-pointer"
            >
              {p.productid} | {p.name}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <>
          {/* Variant selector */}
          <div className="grid gap-1">
            <Label>Variant</Label>
            <Select onValueChange={setVariantId} value={variantId || undefined}>
              <SelectTrigger>
                <SelectValue placeholder="Select variant" />
              </SelectTrigger>
              <SelectContent>
                {variants.map((v) => (
                  <SelectItem
                    key={v.variantid}
                    value={v.variantid}
                    disabled={v.stock <= 0}
                  >
                    {v.color} | {v.size} | (Stock: {v.stock})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity input */}
          <div className="grid gap-1">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={1}
              placeholder="Enter Quantity"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          {/* Alteration charge */}
          <div className="grid gap-1">
            <Label>Alteration Charges</Label>
            <Input
              type="number"
              min={0}
              placeholder="Alteration Charges"
              value={alterationCharge}
              onChange={(e) => setAlterationCharge(e.target.value)}
            />
          </div>

          {/* Discount input */}
          <div className="grid gap-1">
            <Label>Discount (%)</Label>
            <Input
              type="number"
              min={0}
              max={20}
              placeholder="Discount %"
              value={discount}
              onChange={(e) => {
                let val = e.target.value;
                if (val && Number(val) > 20) val = 20; // enforce max
                if (val && Number(val) < 0) val = 0; // enforce min
                setDiscount(val);
              }}
            />
          </div>

          {/* GST selector */}
          <div className="grid gap-1">
            <Label>GST (%)</Label>
            <Select
              value={gstRate?.toString()}
              onValueChange={(val) => setGstRate(Number(val))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select GST %" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="18">18%</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            disabled={!variantId || !!error}
            onClick={() =>
              onPicked({
                _id: uuidv4(),
                product: selected,
                variantid: variantId,
                quantity: qty,
                alt_charge: Number(alterationCharge) || 0,
                discount: Number(discount) || 0,
                gstRate: gstRate,
              })
            }
          >
            Add
          </Button>
        </>
      )}
    </div>
  );
}
