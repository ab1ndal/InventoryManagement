export default function Summary({ computed }) {
  return (
    <div className="grid gap-2 rounded border p-3">
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{computed.itemsSubtotal}</span>
      </div>
      <div className="flex justify-between">
        <span>Discounts</span>
        <span>
          -{computed.itemLevelDiscountTotal + computed.overallDiscount}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Taxable</span>
        <span>{computed.taxableTotal}</span>
      </div>
      <div className="flex justify-between">
        <span>GST</span>
        <span>{computed.gstTotal}</span>
      </div>
      <div className="flex justify-between font-bold">
        <span>Total</span>
        <span>{computed.grandTotal}</span>
      </div>
    </div>
  );
}
