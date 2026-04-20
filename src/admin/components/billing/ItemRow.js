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
import { priceItem, money } from "./billUtils";

export default function ItemRow({ item, onUpdate, onRemove, onEdit }) {
  const pricing = priceItem(item);
  const [discountRaw, setDiscountRaw] = useState(null);

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
      <td className="px-2 py-1 text-center">
        <Input
          type="number"
          min={1}
          value={item.quantity}
          onChange={(e) =>
            onUpdate(item._id, {
              quantity: parseInt(e.target.value || "1", 10),
            })
          }
          className="h-7 w-14 mx-auto text-center"
        />
      </td>
      <td className="px-2 py-1 text-s text-center tabular-nums">
        {money(item.mrp)}
      </td>
      <td className="px-2 py-1 text-center">
        <Input
          type="number"
          min={0}
          max={50}
          value={
            discountRaw !== null ? discountRaw : (item.quickDiscountPct ?? "")
          }
          onFocus={() =>
            setDiscountRaw(
              item.quickDiscountPct === 0
                ? ""
                : String(item.quickDiscountPct ?? ""),
            )
          }
          onChange={(e) => setDiscountRaw(e.target.value)}
          onBlur={(e) => {
            const val = Math.min(50, Math.max(0, Number(e.target.value) || 0));
            onUpdate(item._id, { quickDiscountPct: val });
            setDiscountRaw(null);
          }}
          className="h-7 w-16 mx-auto text-center"
        />
      </td>
      <td className="px-2 py-1 text-center">
        {money(item.alteration_charge) || 0}
      </td>
      <td className="px-2 py-1 text-center">
        <Select
          value={String(item.gstRate ?? 18)}
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
      <td className="px-2 py-1 text-center tabular-nums">
        {money(pricing.subtotal)}
      </td>
      <td className="px-2 py-1 text-center tabular-nums">
        {money(pricing.gst_amount)}
      </td>
      <td className="px-2 py-1 text-center font-medium tabular-nums">
        {money(pricing.total)}
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
