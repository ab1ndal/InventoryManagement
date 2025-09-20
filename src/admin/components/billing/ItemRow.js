import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../../../components/ui/select";
import { Button } from "../../../components/ui/button";

export default function ItemRow({ item, onUpdate, onRemove }) {
  return (
    <tr className="border-t">
      <td className="p-2">{item.product_name || "Unnamed"}</td>
      <td className="p-2 text-right">
        <Input
          type="number"
          min={1}
          value={item.quantity}
          onChange={(e) =>
            onUpdate(item._id, {
              quantity: parseInt(e.target.value || "1", 10),
            })
          }
          className="h-8 w-20 text-right"
        />
      </td>
      <td className="p-2 text-right">{item.mrp}</td>
      <td className="p-2 text-right">
        <Select
          value={String(item.quickDiscountPct || 0)}
          onValueChange={(v) =>
            onUpdate(item._id, { quickDiscountPct: Number(v) })
          }
        >
          <SelectTrigger className="h-8 w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[0, 5, 10, 15, 20].map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p}%
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="p-2 text-right">{item.stitching_charge}</td>
      <td className="p-2 text-right">{item.gstRate}</td>
      <td className="p-2 text-right">—</td>
      <td className="p-2 text-right">—</td>
      <td className="p-2 text-right">—</td>
      <td className="p-2 text-right">
        <Button variant="ghost" size="sm" onClick={() => onRemove(item._id)}>
          Remove
        </Button>
      </td>
    </tr>
  );
}
