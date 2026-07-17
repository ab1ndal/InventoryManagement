import { useState } from "react";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Button } from "../../../components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { priceItem, money, round2 } from "./billUtils";

export default function ItemRow({ item, onUpdate, onRemove, onEdit, salespersonMap = {}, docType = 'bos' }) {
  const pricing = priceItem(item);
  const isBos = docType === 'bos';
  const [discountRaw, setDiscountRaw] = useState(null);
  const [discountUnit, setDiscountUnit] = useState("pct"); // "pct" | "amt"
  const base = Number(item.mrp || 0) * Number(item.quantity || 1);

  // Bill of Supply carries no GST: subtotal is goods after discount, and total
  // adds the full (as-entered) alteration charge. Mirrors buildBillItemsPayload.
  const subtotal = isBos ? round2(pricing.afterDisc) : pricing.subtotal;
  const total = isBos
    ? round2(pricing.afterDisc + pricing.alteration + pricing.alterGst)
    : pricing.total;

  return (
    <tr className="border-t text-xs">
      <td className="px-2 py-1">
        <div className="font-medium">
          {item.productid || item.manual_code || "—"}
        </div>
        <div className="text-xs text-muted-foreground">
          {item.product_name || item.manual_name || item.category || "—"}
        </div>
        {(item.color || item.size) && (
          <div className="text-xs text-muted-foreground">
            {[item.color, item.size].filter(Boolean).join(" / ")}
          </div>
        )}
      </td>
      <td className="px-2 py-1 text-xs text-muted-foreground">
        {item.salesperson_id ? (salespersonMap[item.salesperson_id] ?? "—") : "—"}
      </td>
      <td className="px-2 py-1 text-center">
        <div className="flex items-center justify-center gap-1">
          <Input
            type="number"
            min={item.unit_type === "meter" ? 0.01 : 1}
            step={item.unit_type === "meter" ? 0.01 : 1}
            value={item.quantity}
            onChange={(e) =>
              onUpdate(item._id, {
                quantity:
                  item.unit_type === "meter"
                    ? parseFloat(e.target.value || "0.01")
                    : parseInt(e.target.value || "1", 10),
              })
            }
            className="h-7 w-20 text-center"
          />
          {item.unit_type === "meter" && (
            <span className="text-xs text-muted-foreground">m</span>
          )}
        </div>
      </td>
      <td className="px-2 py-1 text-s text-center tabular-nums">
        {money(item.mrp)}{item.unit_type === "meter" && <span className="text-xs text-muted-foreground">/m</span>}
      </td>
      <td className="px-2 py-1 text-center">
        <div className="flex items-center justify-center gap-1">
          <Input
            type="number"
            min={0}
            max={discountUnit === "pct" ? 50 : base * 0.5}
            value={
              discountRaw !== null
                ? discountRaw
                : discountUnit === "pct"
                  ? (item.quickDiscountPct ?? "")
                  : (round2((base * Number(item.quickDiscountPct || 0)) / 100) || "")
            }
            onFocus={() => {
              if (discountUnit === "pct") {
                setDiscountRaw(
                  item.quickDiscountPct === 0
                    ? ""
                    : String(item.quickDiscountPct ?? ""),
                );
              } else {
                const amt = round2((base * Number(item.quickDiscountPct || 0)) / 100);
                setDiscountRaw(amt === 0 ? "" : String(amt));
              }
            }}
            onChange={(e) => setDiscountRaw(e.target.value)}
            onBlur={(e) => {
              const raw = Number(e.target.value) || 0;
              let pct;
              if (discountUnit === "pct") {
                pct = Math.min(50, Math.max(0, raw));
              } else {
                const amt = Math.min(Math.max(0, raw), base * 0.5);
                pct = base > 0 ? round2((amt / base) * 100) : 0;
              }
              onUpdate(item._id, { quickDiscountPct: pct });
              setDiscountRaw(null);
            }}
            className="h-7 w-20 text-center"
          />
          <button
            type="button"
            onClick={() => {
              setDiscountUnit((u) => (u === "pct" ? "amt" : "pct"));
              setDiscountRaw(null);
            }}
            className="text-xs text-muted-foreground border rounded px-1 py-0.5 hover:bg-gray-100 w-6"
            title="Toggle discount unit"
          >
            {discountUnit === "pct" ? "%" : "₹"}
          </button>
        </div>
      </td>
      <td className="px-2 py-1 text-center">
        {money(item.alteration_charge) || 0}
      </td>
      {!isBos && (
        <td className="px-2 py-1 text-center">
          <Select
            value={String(pricing.gstRate ?? item.gstRate ?? 18)}
            onValueChange={(v) => onUpdate(item._id, { gstRate: Number(v) })}
          >
            <SelectTrigger className="h-7 w-16 mx-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[5, 18].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}%
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </td>
      )}
      <td className="px-2 py-1 text-center tabular-nums">
        {money(subtotal)}
      </td>
      {!isBos && (
        <td className="px-2 py-1 text-center tabular-nums">
          {money(pricing.gst_amount)}
        </td>
      )}
      <td className="px-2 py-1 text-center font-medium tabular-nums">
        {money(total)}
      </td>
      <td className="px-2 py-1 text-center">
        <div className="flex justify-center gap-1">
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(item._id)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onRemove(item._id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
