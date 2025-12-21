import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function TotalValuePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadInventoryStats = async () => {
      setLoading(true);

      const { data, error } = await supabase.rpc("inventory_stats_by_category");

      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      setRows(data || []);
      setLoading(false);
    };

    loadInventoryStats();
  }, []);

  if (loading) return <div className="p-6">Loading…</div>;
  if (!rows.length) return <div className="p-6">No inventory data</div>;

  const formatCurrency = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });

  const totals = rows.reduce(
    (acc, r) => {
      acc.uniqueProducts += Number(r.unique_product_count || 0);
      acc.totalUnits += Number(r.total_units || 0);
      acc.purchaseValue += Number(r.total_purchase_value || 0);
      acc.retailValue += Number(r.total_retail_value || 0);
      return acc;
    },
    {
      uniqueProducts: 0,
      totalUnits: 0,
      purchaseValue: 0,
      retailValue: 0,
    }
  );

  const totalMargin = totals.retailValue - totals.purchaseValue;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">
        Inventory Value by Category
      </h1>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-gray-200 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left">Category</th>
              <th className="px-4 py-2 text-right">Unique Products</th>
              <th className="px-4 py-2 text-right">Total Units</th>
              <th className="px-4 py-2 text-right">Purchase Value</th>
              <th className="px-4 py-2 text-right">Retail Value</th>
              <th className="px-4 py-2 text-right">Potential Margin</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const margin =
                Number(r.total_retail_value || 0) -
                Number(r.total_purchase_value || 0);

              return (
                <tr
                  key={r.category}
                  className="border-t border-gray-200 hover:bg-gray-50"
                >
                  <td className="px-4 py-2 font-medium">{r.category}</td>
                  <td className="px-4 py-2 text-right">
                    {r.unique_product_count}
                  </td>
                  <td className="px-4 py-2 text-right">{r.total_units}</td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(r.total_purchase_value)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {formatCurrency(r.total_retail_value)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold">
                    {formatCurrency(margin)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-gray-100 border-t-2 border-gray-300">
            <tr>
              <td className="px-4 py-2 font-semibold">Total</td>
              <td className="px-4 py-2 text-right font-semibold">
                {totals.uniqueProducts}
              </td>
              <td className="px-4 py-2 text-right font-semibold">
                {totals.totalUnits}
              </td>
              <td className="px-4 py-2 text-right font-semibold">
                {formatCurrency(totals.purchaseValue)}
              </td>
              <td className="px-4 py-2 text-right font-semibold">
                {formatCurrency(totals.retailValue)}
              </td>
              <td className="px-4 py-2 text-right font-semibold">
                {formatCurrency(totalMargin)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
