// src/admin/components/SupplierLedgerDialog.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { formatDate } from "../../utility/dateFormat";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Badge } from "../../components/ui/badge";

export default function SupplierLedgerDialog({ supplier, open, onOpenChange }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && supplier) {
      fetchLedger();
    }
  }, [open, supplier]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchLedger = async () => {
    setLoading(true);

    const [{ data: txns, error: txnErr }, { data: bills }] =
      await Promise.all([
        supabase
          .from("supplier_transactions")
          .select("*")
          .eq("supplier_id", supplier.supplierid)
          .order("transaction_date", { ascending: true })
          .order("transaction_id", { ascending: true }),
        supabase
          .from("supplier_bills")
          .select("transaction_id, image_url")
          .eq("supplier_id", supplier.supplierid),
      ]);

    if (txnErr) {
      console.error("Error fetching transactions:", txnErr.message);
      setLoading(false);
      return;
    }

    const billsByTxn = Object.fromEntries(
      (bills || []).map((b) => [b.transaction_id, b.image_url])
    );

    let running = 0;
    const computed = (txns || []).map((t) => {
      running += t.type === "bill" ? Number(t.amount) : -Number(t.amount);
      return { ...t, running, imageUrl: billsByTxn[t.transaction_id] ?? null };
    });

    setRows(computed);
    setLoading(false);
  };

  const finalBalance = rows.length > 0 ? rows[rows.length - 1].running : 0;

  const balanceClass = (val) => {
    if (val > 0) return "text-red-600 font-semibold";
    if (val < 0) return "text-green-600 font-semibold";
    return "text-gray-400";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl bg-white rounded-lg shadow-xl p-6">
        <DialogHeader>
          <DialogTitle>Ledger — {supplier?.name}</DialogTitle>
          <DialogDescription>
            Chronological record of all bills and payments.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            No transactions yet.
          </div>
        ) : (
          <>
            <ScrollArea className={rows.length > 20 ? "h-[480px]" : undefined}>
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="p-2 text-left font-semibold">Date</th>
                    <th className="p-2 text-left font-semibold">Type</th>
                    <th className="p-2 text-left font-semibold">Notes</th>
                    <th className="p-2 text-right font-semibold">Debit (Bill)</th>
                    <th className="p-2 text-right font-semibold">Credit (Payment)</th>
                    <th className="p-2 text-right font-semibold">Balance</th>
                    <th className="p-2 text-center font-semibold">Image</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.transaction_id} className="border-t hover:bg-gray-50">
                      <td className="p-2 whitespace-nowrap">
                        {formatDate(row.transaction_date)}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant="outline"
                          className={
                            row.type === "bill"
                              ? "bg-red-100 text-red-700 border-none"
                              : "bg-green-100 text-green-700 border-none"
                          }
                        >
                          {row.type === "bill" ? "Bill" : "Payment"}
                        </Badge>
                      </td>
                      <td className="p-2 text-gray-500 max-w-[180px] truncate">
                        {row.notes || "-"}
                      </td>
                      <td className="p-2 text-right tabular-nums text-red-600">
                        {row.type === "bill" ? `₹${Number(row.amount).toFixed(2)}` : ""}
                      </td>
                      <td className="p-2 text-right tabular-nums text-green-600">
                        {row.type === "payment" ? `₹${Number(row.amount).toFixed(2)}` : ""}
                      </td>
                      <td className={`p-2 text-right tabular-nums ${balanceClass(row.running)}`}>
                        ₹{row.running.toFixed(2)}
                      </td>
                      <td className="p-2 text-center">
                        {row.imageUrl ? (
                          <a
                            href={row.imageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {/* Footer balance */}
            <div className="border-t pt-3 mt-2 flex justify-end">
              <span className="text-sm font-bold">
                Current Balance:{" "}
                <span className={balanceClass(finalBalance)}>
                  ₹{finalBalance.toFixed(2)}
                </span>
                {finalBalance > 0 && (
                  <span className="ml-1 text-xs text-red-500 font-normal">(owed)</span>
                )}
                {finalBalance < 0 && (
                  <span className="ml-1 text-xs text-green-500 font-normal">(overpaid)</span>
                )}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
