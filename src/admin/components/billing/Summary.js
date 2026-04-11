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
  const totalDiscount = round2(
    computed.itemLevelDiscountTotal + computed.overallDiscount
  );

  // D-24 deduction order: voucher before store credit; both floor at 0
  const voucherAmount = Number(appliedVoucher?.value ?? 0);
  const preVoucherTotal = computed.grandTotal;
  // Voucher applies before store credit; clamp so total floors at 0
  const voucherApplied = Math.min(voucherAmount, preVoucherTotal);
  const postVoucherTotal = Math.max(0, preVoucherTotal - voucherApplied);
  const storeCreditApplied = Math.min(Number(appliedStoreCredit || 0), postVoucherTotal);
  const effectiveGrandTotal = Math.max(0, postVoucherTotal - storeCreditApplied);

  const totalSavings = round2(totalDiscount + voucherApplied + storeCreditApplied);

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
          <span>Voucher #{appliedVoucher.voucher_id}: {money(voucherApplied)} applied</span>
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

      {storeCreditApplied > 0 && (
        <div className="flex justify-between items-center bg-green-50 border border-green-200 text-green-800 rounded px-3 py-1.5 text-sm">
          <span>Store credit applied</span>
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

      <div className="flex justify-between text-muted-foreground">
        <span>GST</span>
        <span className="tabular-nums">+{money(computed.gstTotal)}</span>
      </div>

      <div className="flex justify-between font-bold text-base border-t pt-2 mt-1">
        <span>Total</span>
        <div className="text-right">
          <div className="tabular-nums">{money(effectiveGrandTotal)}</div>
          {totalSavings > 0 && (
            <div className="text-xs font-normal text-green-600 tabular-nums">
              (You save {money(totalSavings)})
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
