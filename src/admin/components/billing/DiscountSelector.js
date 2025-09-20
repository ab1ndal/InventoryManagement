import { Checkbox } from "../../../components/ui/checkbox";

export default function DiscountSelector({
  discounts,
  selectedCodes,
  onToggle,
}) {
  return (
    <div className="grid gap-2">
      {discounts.map((d) => (
        <label
          key={d.code}
          className="flex items-center gap-2 border rounded p-2"
        >
          <Checkbox
            checked={selectedCodes.includes(d.code)}
            onCheckedChange={() => onToggle(d.code)}
          />
          <span>{d.code}</span>
        </label>
      ))}
    </div>
  );
}
