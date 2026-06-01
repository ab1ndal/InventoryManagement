import React from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "../../../components/ui/table";
import { formatINR } from "../../../utility/formatCurrency";
import { aggregateSalespersons } from "../../../utility/dashboardData";

export default function SalespersonTable({ current, salespersonsById, loading }) {
  if (loading) {
    return <div className="bg-white rounded-xl border border-gray-200 p-5 text-sm text-gray-400">Loading…</div>;
  }
  const rows = aggregateSalespersons(current.items, salespersonsById);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Salesperson Performance</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Bills</TableHead>
            <TableHead className="text-right">AOV</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={5} className="text-center text-gray-400">No sales</TableCell></TableRow>
          ) : (
            rows.map((r) => (
              <TableRow key={r.salespersonId} data-testid="salesperson-row">
                <TableCell>{r.rank}</TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="text-right">{r.bills}</TableCell>
                <TableCell className="text-right">{formatINR(r.aov)}</TableCell>
                <TableCell className="text-right">{formatINR(r.revenue)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
