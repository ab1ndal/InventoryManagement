// src/admin/components/billing/PaymentHistory.js
import { money } from "./billUtils";

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function PaymentHistory({ payments, netAmount }) {
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const balanceDue = Math.max(0, Number(netAmount) - totalPaid);

  return (
    <div className="rounded border p-4 space-y-2 text-sm bg-gray-50">
      <div className="font-semibold text-sm">Payment History</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-1 font-normal">Date</th>
            <th className="text-left py-1 font-normal">Method</th>
            <th className="text-right py-1 font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.payment_id} className="border-b last:border-0">
              <td className="py-1">{fmtDate(p.recorded_at)}</td>
              <td className="py-1">{p.salesmethods?.methodname || "—"}</td>
              <td className="py-1 text-right tabular-nums">{money(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t pt-2 flex justify-between font-semibold">
        <span>Total Paid</span>
        <span className="tabular-nums">{money(totalPaid)}</span>
      </div>
      {balanceDue > 0 ? (
        <div className="flex justify-between font-bold text-red-600">
          <span>Balance Due</span>
          <span className="tabular-nums">{money(balanceDue)}</span>
        </div>
      ) : (
        <div className="flex justify-between font-semibold text-green-600">
          <span>Paid in Full</span>
          <span>✓</span>
        </div>
      )}
    </div>
  );
}
