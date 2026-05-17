// src/admin/components/SupplierTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { formatPhone } from "../../utility/formatPhone";
import { formatINR } from "../../utility/formatCurrency";

export default function SupplierTable({
  refreshSignal,
  onEditSupplier,
  onAddTransaction,
  onViewLedger,
}) {
  const [suppliers, setSuppliers] = useState([]);
  const [balances, setBalances] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [refreshSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async () => {
    setLoading(true);

    const [{ data: supplierData, error: supErr }, { data: txnData }] =
      await Promise.all([
        supabase.from("suppliers").select("*").order("name"),
        supabase.from("supplier_transactions").select("supplier_id, type, amount"),
      ]);

    if (supErr) {
      console.error("Error fetching suppliers:", supErr.message);
      setLoading(false);
      return;
    }

    // Compute balance per supplier: sum(bills) - sum(payments)
    const computed = {};
    for (const txn of txnData || []) {
      const prev = computed[txn.supplier_id] ?? 0;
      computed[txn.supplier_id] =
        txn.type === "bill"
          ? prev + Number(txn.amount)
          : prev - Number(txn.amount);
    }

    setSuppliers(supplierData || []);
    setBalances(computed);
    setLoading(false);
  };

  const balanceColor = (bal) => {
    if (bal > 0) return "text-red-600 font-medium";
    if (bal < 0) return "text-green-600 font-medium";
    return "text-gray-400";
  };

  return (
    <div className="overflow-auto border rounded-md">
      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
      ) : (
        <table className="min-w-full text-sm text-left">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-3 font-semibold">Name</th>
              <th className="p-3 font-semibold">Phone</th>
              <th className="p-3 font-semibold">Email</th>
              <th className="p-3 font-semibold text-right">Balance</th>
              <th className="p-3 font-semibold text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-gray-400">
                  No suppliers yet
                </td>
              </tr>
            ) : (
              suppliers.map((s) => {
                const bal = balances[s.supplierid] ?? 0;
                return (
                  <tr key={s.supplierid} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium">{s.name}</td>
                    <td className="p-3 text-gray-600">{formatPhone(s.phone)}</td>
                    <td className="p-3 text-gray-600">{s.email || "-"}</td>
                    <td className={`p-3 text-right tabular-nums ${balanceColor(bal)}`}>
                      {formatINR(bal, 2)}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEditSupplier?.(s)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onAddTransaction?.(s)}
                        >
                          Add Transaction
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onViewLedger?.(s)}
                        >
                          View Ledger
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
