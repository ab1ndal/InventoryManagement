// src/admin/components/dashboard/DiscountTable.js
import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateDiscounts } from "../../../utility/dashboardData";

export default function DiscountTable({ current, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const d = aggregateDiscounts(current.bills, current.items);
  const rows = [
    { label: "Code-driven", bills: d.code.bills, amount: d.code.amount },
    { label: "Manual", bills: d.manual.bills, amount: d.manual.amount },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Discount Impact</h3>
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs text-gray-500">Total Discount</span>
        <span className="text-xl font-semibold text-gray-900">{formatINR(d.total)}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Bills</TableHead>
            <TableHead className="text-right">₹ Given</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.label}>
              <TableCell className="font-medium">{r.label}</TableCell>
              <TableCell className="text-right">{r.bills}</TableCell>
              <TableCell className="text-right">{formatINR(r.amount)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
