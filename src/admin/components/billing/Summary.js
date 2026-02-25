import { money, round2 } from "./billUtils";

export default function Summary({ computed }) {
  const totalDiscount = round2(
    computed.itemLevelDiscountTotal + computed.overallDiscount
  );

  return (
    <div className="rounded border p-4 space-y-2 text-sm bg-gray-50">
      <div className="flex justify-between text-muted-foreground">
        <span>Subtotal (MRP + Alterations)</span>
        <span className="tabular-nums">{money(computed.itemsSubtotal)}</span>
      </div>

      {computed.itemLevelDiscountTotal > 0 && (
        <div className="flex justify-between text-red-600">
          <span>Item Discounts</span>
          <span className="tabular-nums">−{money(computed.itemLevelDiscountTotal)}</span>
        </div>
      )}

      {computed.overallDiscount > 0 && (
        <div className="flex justify-between text-red-600">
          <span>Code Discounts</span>
          <span className="tabular-nums">−{money(computed.overallDiscount)}</span>
        </div>
      )}

      <div className="flex justify-between text-muted-foreground">
        <span>GST</span>
        <span className="tabular-nums">+{money(computed.gstTotal)}</span>
      </div>

      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
        <span>Total</span>
        <div className="text-right">
          <div className="tabular-nums">{money(computed.grandTotal)}</div>
          {totalDiscount > 0 && (
            <div className="text-xs font-normal text-green-600 tabular-nums">
              (You save {money(totalDiscount)})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
