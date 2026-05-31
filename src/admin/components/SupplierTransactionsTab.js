import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { formatDate } from "../../utility/dateFormat";
import { formatINR } from "../../utility/formatCurrency";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import SupplierTransactionDialog from "./SupplierTransactionDialog";

export default function SupplierTransactionsTab() {
  const [transactions, setTransactions] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterType, setFilterType] = useState("");
  const [loading, setLoading] = useState(true);
  const [txnDialogOpen, setTxnDialogOpen] = useState(false);
  const [txnSupplier, setTxnSupplier] = useState(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  useEffect(() => {
    fetchAll();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: supData }, { data: txnData, error }] = await Promise.all([
      supabase.from("suppliers").select("supplierid, name").order("name"),
      supabase
        .from("supplier_transactions")
        .select("*, suppliers(name)")
        .order("transaction_date", { ascending: false })
        .order("transaction_id", { ascending: false }),
    ]);
    if (!error) {
      setSuppliers(supData || []);
      setTransactions(txnData || []);
    }
    setLoading(false);
  };

  const filtered = transactions.filter((t) => {
    if (filterSupplier && String(t.supplier_id) !== filterSupplier) return false;
    if (filterType && t.type !== filterType) return false;
    return true;
  });

  const typeBadgeClass = (type) => {
    if (type === "bill") return "bg-red-100 text-red-700 border-none";
    if (type === "advance") return "bg-yellow-100 text-yellow-700 border-none";
    return "bg-green-100 text-green-700 border-none";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterSupplier}
            onChange={(e) => setFilterSupplier(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s.supplierid} value={String(s.supplierid)}>{s.name}</option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">All Types</option>
            <option value="bill">Bill</option>
            <option value="payment">Payment</option>
            <option value="advance">Advance</option>
          </select>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setTxnSupplier(suppliers.length === 1 ? suppliers[0] : null);
            setTxnDialogOpen(true);
          }}
        >
          + Add Transaction
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-gray-400 text-sm">Loading…</div>
      ) : (
        <div className="overflow-auto border rounded-md">
          <table className="min-w-full text-sm text-left">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-3 font-semibold">Date</th>
                <th className="p-3 font-semibold">Supplier</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Invoice No</th>
                <th className="p-3 font-semibold text-right">Debit</th>
                <th className="p-3 font-semibold text-right">Credit</th>
                <th className="p-3 font-semibold">Mode</th>
                <th className="p-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-gray-400">No transactions found</td>
                </tr>
              ) : (
                filtered.map((t) => (
                  <tr key={t.transaction_id} className="border-t hover:bg-gray-50">
                    <td className="p-3 whitespace-nowrap">{formatDate(t.transaction_date)}</td>
                    <td className="p-3 font-medium">{t.suppliers?.name ?? "—"}</td>
                    <td className="p-3">
                      <Badge variant="outline" className={typeBadgeClass(t.type)}>
                        {t.type === "bill" ? "Bill" : t.type === "advance" ? "Advance" : "Payment"}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{t.invoice_number || "—"}</td>
                    <td className="p-3 text-right tabular-nums text-red-600">
                      {t.type === "bill" ? formatINR(t.amount, 2) : ""}
                    </td>
                    <td className="p-3 text-right tabular-nums text-green-600">
                      {t.type !== "bill" ? formatINR(t.amount, 2) : ""}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground capitalize">{t.payment_mode || "—"}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[160px] truncate">{t.notes || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {txnDialogOpen && txnSupplier && (
        <SupplierTransactionDialog
          supplier={txnSupplier}
          open={txnDialogOpen}
          onOpenChange={setTxnDialogOpen}
          onSuccess={() => {
            setTxnDialogOpen(false);
            setRefreshSignal((p) => p + 1);
          }}
        />
      )}

      {txnDialogOpen && !txnSupplier && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl space-y-3">
            <p className="font-semibold">Select supplier first:</p>
            {suppliers.map((s) => (
              <Button
                key={s.supplierid}
                variant="outline"
                className="w-full"
                onClick={() => setTxnSupplier(s)}
              >
                {s.name}
              </Button>
            ))}
            <Button variant="ghost" className="w-full" onClick={() => setTxnDialogOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
