import { money, round2 } from "./billUtils";

export default function Summary({
  computed,
  appliedStoreCredit,
  appliedVoucher,
  customerStoreCreditBalance = 0,
  onRemoveStoreCredit,
  onApplyStoreCredit,
  onRemoveVoucher,
}) {
  // voucher is pre-tax (baked into computed.grandTotal via computeBillTotals)
  const voucherApplied = Number(computed.voucherPreTax ?? 0);
  const totalDiscount = round2(
    computed.itemLevelDiscountTotal + computed.overallDiscount
  );
  const totalPreTaxDiscount = round2(totalDiscount + (computed.balanceDiscount || 0) + voucherApplied);
  const discountPct = computed.itemsSubtotal > 0
    ? round2((totalPreTaxDiscount / computed.itemsSubtotal) * 100)
    : 0;

  // store credit is a customer payment applied after grand total
  const storeCreditApplied = Math.min(Number(appliedStoreCredit || 0), computed.grandTotal);
  const effectiveGrandTotal = Math.max(0, computed.grandTotal - storeCreditApplied);

  const totalSavings = round2(totalPreTaxDiscount + storeCreditApplied);

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

      {appliedVoucher && voucherApplied > 0 && (
        <div className="flex justify-between items-center bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-1.5 text-sm">
          <span>Voucher #{appliedVoucher.voucher_id} (pre-tax): {money(voucherApplied)} applied</span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">−{money(voucherApplied)}</span>
            {onRemoveVoucher && (
              <button
                type="button"
                className="text-blue-600 hover:text-blue-900"
                aria-label="Remove voucher"
                onClick={onRemoveVoucher}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {computed.balanceDiscount > 0 && (
        <div className="flex justify-between text-orange-600">
          <span>Balance Discount (pre-tax)</span>
          <span className="tabular-nums">−{money(computed.balanceDiscount)}</span>
        </div>
      )}

      <div className="flex justify-between text-muted-foreground">
        <span>GST</span>
        <span className="tabular-nums">+{money(computed.gstTotal)}</span>
      </div>

      {totalPreTaxDiscount > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground border-t pt-1 mt-1">
          <span>Total Discount</span>
          <span className="tabular-nums text-red-600">{money(totalPreTaxDiscount)} ({discountPct}% off MRP)</span>
        </div>
      )}

      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
        <span>Total</span>
        <div className="text-right">
          <div className="tabular-nums">{money(computed.grandTotal)}</div>
          {totalSavings > 0 && (
            <div className="text-xs font-normal text-green-600 tabular-nums">
              (You save {money(totalSavings)})
            </div>
          )}
        </div>
      </div>

      {storeCreditApplied > 0 && (
        <div className="flex justify-between items-center bg-green-50 border border-green-200 text-green-800 rounded px-3 py-1.5 text-sm">
          <span>Paid via Store Credit</span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">−{money(storeCreditApplied)}</span>
            {onRemoveStoreCredit && (
              <button
                type="button"
                className="text-green-600 hover:text-green-900"
                aria-label="Remove store credit"
                onClick={onRemoveStoreCredit}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}

      {storeCreditApplied === 0 && Number(customerStoreCreditBalance || 0) > 0 && onApplyStoreCredit && (
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-green-700 hover:text-green-900 underline"
            onClick={onApplyStoreCredit}
          >
            Apply store credit (₹{Number(customerStoreCreditBalance).toFixed(2)})
          </button>
        </div>
      )}

      {storeCreditApplied > 0 && (
        <div className="flex justify-between font-semibold text-sm border-t pt-1 mt-1">
          <span>Net Payable</span>
          <span className="tabular-nums">{money(effectiveGrandTotal)}</span>
        </div>
      )}
    </div>
  );
}
