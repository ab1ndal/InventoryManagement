import { useState, useEffect, useRef } from "react";
import { formatINR } from "../../../utility/formatCurrency";
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
import { sortVariantsBySizeColor } from "../../../utility/sortVariants";

export default function InventoryPicker({ onPicked, initialVal, isBackdated, salespersons = [] }) {
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
  const [stitchType, setStitchType] = useState(initialVal?.stitchType || 'unstitched');
  const [gstRate, setGstRate] = useState(initialVal?.gstRate || null);
  const [discount, setDiscount] = useState(initialVal?.quickDiscountPct || 0);
  const [salespersonId, setSalespersonId] = useState(initialVal?.salesperson_id || null);
  const variantsLoadedFor = useRef(null);

  // When editing, load the product and its variants together on mount
  useEffect(() => {
    if (!initialVal?.productid) return;
    Promise.all([
      supabase
        .from("products_admin")
        .select("productid, categoryid, purchaseprice, retailprice, name, unit_type")
        .eq("productid", initialVal.productid)
        .single(),
      supabase
        .from("productsizecolors")
        .select("variantid, productid, size, color, stock")
        .eq("productid", initialVal.productid),
    ]).then(([{ data: product }, { data: productVariants }]) => {
      setVariants(sortVariantsBySizeColor(productVariants || []));
      variantsLoadedFor.current = initialVal.productid;
      if (product) setSelected(product);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Search products only after 6 characters, and only for what the user typed: the code an edit
  // starts with is not a search, and its list would open over the form.
  useEffect(() => {
    if (selected || query === initialVal?.productid) {
      setResults([]);
      return;
    }
    let superseded = false;
    const run = async () => {
      if (query.length < 6) {
        setResults([]);
        return;
      }
      const { data, error } = await supabase
        .from("products_admin")
        .select("productid, categoryid, purchaseprice, retailprice, name, unit_type")
        .ilike("productid", `%${query}%`)
        .order("productid");
      if (!superseded && !error) setResults(data || []);
    };
    const t = setTimeout(run, 300);
    return () => {
      superseded = true;
      clearTimeout(t);
    };
  }, [query, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load variants for selected product
  useEffect(() => {
    if (!selected) return undefined;
    if (variantsLoadedFor.current === selected.productid) {
      variantsLoadedFor.current = null;
      return undefined;
    }
    // Clear first: the previous product's variants must not be choosable while these load.
    setVariants([]);
    let superseded = false;
    supabase
      .from("productsizecolors")
      .select("variantid, productid, size, color, stock")
      .eq("productid", selected.productid)
      .then(({ data }) => {
        if (!superseded) setVariants(sortVariantsBySizeColor(data || []));
      });
    return () => {
      superseded = true;
    };
  }, [selected]);

  // When editing, the original variant's stock is effectively higher by the original quantity
  const originalVariantId = isEditing ? initialVal?.variantid : null;
  const originalQty = isEditing ? (initialVal?.quantity || 0) : 0;

  const effectiveStock = (variant) => {
    const bonus = variant.variantid === originalVariantId ? originalQty : 0;
    return variant.stock + bonus;
  };

  const isMeter = selected?.unit_type === "meter";

  // Validate quantity
  useEffect(() => {
    if (!variantId || !qty) {
      setError("");
      return;
    }
    const chosenVariant = variants.find((v) => v.variantid === variantId);
    if (!isBackdated && chosenVariant && Number(qty) > effectiveStock(chosenVariant)) {
      const unit = isMeter ? "m" : "pcs";
      setError(`Only ${effectiveStock(chosenVariant)} ${unit} left in stock`);
    } else {
      setError("");
    }
  }, [qty, variantId, variants]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compute GST from stitchType + post-discount price (new items only)
  useEffect(() => {
    if (isEditing) return;
    if (!selected) return;
    const pricePerPiece = (selected.retailprice || 0) * (1 - discount / 100);
    const autoGst = stitchType === 'stitched' && pricePerPiece > 2500 ? 18 : 5;
    setGstRate(autoGst);
  }, [selected, discount, stitchType, isEditing]);

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
        <div className="border rounded bg-white max-h-60 overflow-y-auto">
          {results.map((p) => (
            <button
              type="button"
              key={p.productid}
              onClick={() => {
                setSelected(p);
                setQuery(p.productid);
                setResults([]);
              }}
              className="block w-full p-2 text-left hover:bg-gray-100 focus-visible:bg-gray-100"
            >
              {p.productid} | {p.name}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          <div className="text-sm text-muted-foreground">
            {selected.name} — MRP: {formatINR(selected.retailprice || 0)}
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
                    {v.color} | {v.size} | (Stock: {effectiveStock(v)}{isMeter ? " m" : " pcs"})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Quantity input */}
          <div className="grid gap-1">
            <Label>Quantity {isMeter && <span className="text-xs text-muted-foreground">(meters)</span>}</Label>
            <Input
              type="number"
              min={isMeter ? 0.01 : 1}
              step={isMeter ? 0.01 : 1}
              placeholder={isMeter ? "Enter meters" : "Enter Quantity"}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
          </div>

          {/* Alteration charge (5% GST inclusive) */}
          <div className="grid gap-1">
            <Label>Alteration / Stitching Charges <span className="text-xs text-muted-foreground">(incl. 5% GST)</span></Label>
            <Input
              type="number"
              min={0}
              placeholder="0"
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
              max={50}
              placeholder="0"
              value={discount}
              onFocus={() => { if (Number(discount) === 0) setDiscount(""); }}
              onChange={(e) => setDiscount(e.target.value)}
              onBlur={() => {
                const num = Math.min(50, Math.max(0, Number(discount) || 0));
                setDiscount(num);
              }}
            />
          </div>

          {/* GST — auto-computed, shown read-only */}
          <div className="grid gap-1">
            <Label>GST Rate (auto)</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{gstRate ?? "—"}%</span>
              <span className="text-xs text-muted-foreground">
                {stitchType === 'unstitched' ? '(unstitched fabric — 5%)' : `(stitched — ${gstRate === 18 ? '>₹2500 → 18%' : '≤₹2500 → 5%'})`}
              </span>
            </div>
          </div>

          {/* Salesperson (optional) */}
          {salespersons.length > 0 && (
            <div className="grid gap-1">
              <Label>Salesperson (optional)</Label>
              <Select
                value={salespersonId ? String(salespersonId) : "__none__"}
                onValueChange={(v) => setSalespersonId(v === "__none__" ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="— none —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— none —</SelectItem>
                  {salespersons.map((s) => (
                    <SelectItem key={s.salesperson_id} value={String(s.salesperson_id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Button
            disabled={
              !!error ||
              !variants.some((v) => v.variantid === variantId && v.productid === selected.productid)
            }
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
                category: selected.categoryid || null,
                size: chosenVariant?.size || null,
                color: chosenVariant?.color || null,
                stock: chosenVariant ? effectiveStock(chosenVariant) : null,
                quantity: Number(qty),
                mrp: Number(selected.retailprice || 0),
                quickDiscountPct: Number(discount) || 0,
                gstRate: gstRate,
                alteration_charge: Number(alterationCharge) || 0,
                stitchType,
                unit_type: selected.unit_type || "piece",
                salesperson_id: salespersonId || null,
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
