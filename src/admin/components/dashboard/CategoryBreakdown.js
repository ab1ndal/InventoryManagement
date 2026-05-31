import React from "react";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateCategories } from "../../../utility/dashboardData";

const HUES = ["#0066cc", "#7c3aed", "#06b6d4", "#f59e0b", "#64748b"];

export default function CategoryBreakdown({ current, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const rows = aggregateCategories(current.items);
  const max = rows.length ? rows[0].revenue : 0;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Category Breakdown</h3>
      {rows.length === 0 ? (
        <div className="text-sm text-gray-400">No category data</div>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.category} data-testid="category-row" className="text-xs">
              <div className="flex items-center justify-between mb-0.5">
                <span className="font-medium text-gray-700">{r.category}</span>
                <span className="text-gray-500">
                  <span>{formatINR(r.revenue)}</span>
                  <span> · {r.margin.toFixed(0)}%</span>
                </span>
              </div>
              <div className="h-2 w-full rounded bg-gray-100 overflow-hidden">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${max ? (r.revenue / max) * 100 : 0}%`,
                    backgroundColor: HUES[i % HUES.length],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
