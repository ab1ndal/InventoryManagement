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

export default function InventoryPicker({ onPicked, initialVal, isBackdated }) {
  const isEditing = !!initialVal;

  const [query, setQuery] = useState(initialVal?.productid || "");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [variants, setVariants] = useState([]);
  const [variantId, setVariantId] = useState(initialVal?.variantid || null);
  const [qty, setQty] = useState(initialVal?.quantity || 1);
  const [error, setError] = useState("");

  const [alterationCharge, setAlterationCharge] = useState(
    initialVal?.alteration_charge || 0
  );
  const [gstRate, setGstRate] = useState(initialVal?.gstRate || null);
  const [discount, setDiscount] = useState(initialVal?.quickDiscountPct || 0);

  // When editing, load the full product from Supabase on mount
  useEffect(() => {
    if (!initialVal?.productid) return;
    supabase
      .from("products")
      .select("productid, categoryid, purchaseprice, retailprice, name")
      .eq("productid", initialVal.productid)
      .single()
      .then(({ data }) => {
        if (data) setSelected(data);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Search products only after 6 characters (skip once a product is selected)
  useEffect(() => {
    if (selected) return;
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
  }, [query, isEditing, selected]);

  // Load variants for selected product
  useEffect(() => {
    if (!selected) return;
    supabase
      .from("productsizecolors")
      .select("variantid, productid, size, color, stock")
      .eq("productid", selected.productid)
      .then(({ data }) => setVariants(data || []));
  }, [selected]);

  // When editing, the original variant's stock is effectively higher by the original quantity
  // (that stock is already reserved by this draft bill, so it's available to reassign)
  const originalVariantId = isEditing ? initialVal?.variantid : null;
  const originalQty = isEditing ? (initialVal?.quantity || 0) : 0;

  const effectiveStock = (variant) => {
    const bonus = variant.variantid === originalVariantId ? originalQty : 0;
    return variant.stock + bonus;
  };

  // Validate quantity
  useEffect(() => {
    if (!variantId || !qty) {
      setError("");
      return;
    }
    const chosenVariant = variants.find((v) => v.variantid === variantId);
    if (!isBackdated && chosenVariant && qty > effectiveStock(chosenVariant)) {
      setError(`Only ${effectiveStock(chosenVariant)} left in stock`);
    } else {
      setError("");
    }
  }, [qty, variantId, variants]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute GST only when adding new items (not editing)
  useEffect(() => {
    if (isEditing) return;
    if (!selected) return;

    // GST slab is determined by per-piece taxable price (MRP after per-unit discount, excluding alteration)
    const pricePerPiece = (selected.retailprice || 0) * (1 - discount / 100);

    let autoGst = 18;
    if (
      selected.categoryid === "SA" ||
      selected.categoryid === "ST" ||
      pricePerPiece <= 2500
    ) {
      autoGst = 5;
    }
    setGstRate(autoGst);
  }, [selected, discount, isEditing]);

  return (
    <div className="grid gap-4">
      {/* Product search */}
      <div className="grid gap-1">
        <Label>Product ID</Label>
        <Input
          placeholder="Enter Product ID..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (selected && e.target.value !== selected.productid) {
              setSelected(null);
              setVariantId(null);
            }
          }}
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
          <div className="text-sm text-muted-foreground">
            {selected.name} — MRP: ₹
            {selected.retailprice?.toLocaleString("en-IN")}
          </div>

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
                    disabled={!isBackdated && effectiveStock(v) <= 0}
                  >
                    {v.color} | {v.size} | (Stock: {effectiveStock(v)})
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
            <Label>Alteration / Stitching Charges</Label>
            <Input
              type="number"
              min={0}
              placeholder="Alteration / Stitching Charges"
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
              max={30}
              placeholder="0"
              value={discount}
              onFocus={() => { if (Number(discount) === 0) setDiscount(""); }}
              onChange={(e) => setDiscount(e.target.value)}
              onBlur={() => {
                const num = Math.min(30, Math.max(0, Number(discount) || 0));
                setDiscount(num);
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
            onClick={() => {
              const chosenVariant = variants.find(
                (v) => v.variantid === variantId,
              );
              onPicked({
                _id: uuidv4(),
                source: "inventory",
                productid: selected.productid,
                variantid: variantId,
                product_name: selected.name,
                category: selected.categoryid,
                size: chosenVariant?.size || null,
                color: chosenVariant?.color || null,
                stock: chosenVariant?.stock ?? null,
                quantity: Number(qty),
                mrp: Number(selected.retailprice || 0),
                quickDiscountPct: Number(discount) || 0,
                gstRate: gstRate,
                alteration_charge: Number(alterationCharge) || 0,
              });
            }}
          >
            {isEditing ? "Update" : "Add"}
          </Button>
        </>
      )}
    </div>
  );
}
