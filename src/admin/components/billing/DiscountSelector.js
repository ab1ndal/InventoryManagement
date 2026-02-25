import { Checkbox } from "../../../components/ui/checkbox";
import { Badge } from "../../../components/ui/badge";

function discountLabel(d) {
  const r = d.rules || {};
  switch (d.type) {
    case "flat":
      return `₹${d.value} off${d.max_discount ? ` (max ₹${d.max_discount})` : ""}`;
    case "percentage":
      return `${d.value}% off${d.max_discount ? ` (max ₹${d.max_discount})` : ""}`;
    case "buy_x_get_y":
      return `Buy ${r.buy_qty || 2} Get ${r.get_qty || 1} Free${r.category ? ` on ${r.category}` : ""}`;
    case "fixed_price":
      return `Fixed price ₹${r.fixed_total}${r.category ? ` for ${r.category}` : ""}`;
    case "conditional": {
      const minTotal = r.min_total || d.min_total;
      const val = r.value || d.value;
      return `₹${val} off on orders above ₹${minTotal}`;
    }
    default:
      return d.type;
  }
}

function DiscountRow({ d, selectedCodes, onToggle, isAuto }) {
  const selected = selectedCodes.includes(d.code);
  return (
    <label
      className={`flex items-start gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${
        selected
          ? isAuto
            ? "bg-green-50 border-green-300"
            : "bg-blue-50 border-blue-300"
          : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={() => onToggle(d.code)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {d.code && (
            <span className="font-mono text-sm font-semibold">{d.code}</span>
          )}
          {isAuto && (
            <Badge className="text-xs bg-green-100 text-green-800 hover:bg-green-100">
              Auto-applied
            </Badge>
          )}
          {d.exclusive && (
            <Badge variant="outline" className="text-xs">
              Exclusive
            </Badge>
          )}
          {d.min_total > 0 && (
            <Badge variant="outline" className="text-xs">
              Min ₹{d.min_total}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {discountLabel(d)}
        </p>
        {(d.start_date || d.end_date) && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {d.start_date && `From ${d.start_date}`}
            {d.start_date && d.end_date ? " · " : ""}
            {d.end_date && `Until ${d.end_date}`}
          </p>
        )}
      </div>
    </label>
  );
}

export default function DiscountSelector({ discounts, selectedCodes, onToggle }) {
  const autoOffers = discounts.filter((d) => d.auto_apply);
  const optionalOffers = discounts.filter((d) => !d.auto_apply);

  if (discounts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active offers available.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {autoOffers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
            Active Offers
          </p>
          {autoOffers.map((d) => (
            <DiscountRow
              key={d.code}
              d={d}
              selectedCodes={selectedCodes}
              onToggle={onToggle}
              isAuto
            />
          ))}
        </div>
      )}
      {optionalOffers.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Other Discounts
          </p>
          {optionalOffers.map((d) => (
            <DiscountRow
              key={d.code}
              d={d}
              selectedCodes={selectedCodes}
              onToggle={onToggle}
              isAuto={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
