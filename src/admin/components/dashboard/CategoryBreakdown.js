import React, { useEffect, useState } from "react";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateCategories } from "../../../utility/dashboardData";
import { supabase } from "../../../lib/supabaseClient";

const HUES = ["#0066cc", "#7c3aed", "#06b6d4", "#f59e0b", "#64748b"];

export default function CategoryBreakdown({ current, loading }) {
  const [categoryNames, setCategoryNames] = useState({});

  useEffect(() => {
    supabase
      .from("categories")
      .select("categoryid, name")
      .then(({ data }) => {
        if (data) setCategoryNames(Object.fromEntries(data.map((c) => [c.categoryid, c.name])));
      });
  }, []);

  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const allRows = aggregateCategories(current.items);
  const rows = allRows.slice(0, 10);
  const totalRevenue = allRows.reduce((s, r) => s + r.revenue, 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No category data</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => {
            const sharePct = totalRevenue ? (r.revenue / totalRevenue) * 100 : 0;
            const displayName = categoryNames[r.category] || r.category;
            return (
              <div key={r.category} data-testid="category-row" className="text-xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium text-gray-700">{displayName} <span className="text-gray-400 font-normal">({Math.round(r.count)})</span></span>
                  <span className="text-gray-500">
                    <span>{formatINR(r.revenue)}</span>
                    <span> · {sharePct.toFixed(1)}%</span>
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                  <div
                    className="h-full rounded"
                    style={{
                      width: `${sharePct}%`,
                      backgroundColor: HUES[i % HUES.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
