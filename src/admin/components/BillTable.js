// src/admin/components/BillTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "../../components/hooks/use-toast";
import { Input } from "../../components/ui/input";

const ROWS_PER_PAGE = 15;

export default function BillTable({ onEdit }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [bills, setBills] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ search: "" });

  const loadBills = async () => {
    setLoading(true);
    let query = supabase
      .from("bills")
      .select(
        "billid, customerid, orderdate, totalamount, gst_total, discount_total, finalized",
        { count: "exact" }
      )
      .order("orderdate", { ascending: false })
      .range((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE - 1);

    if (filters.search) {
      query = query.eq("billid", filters.search);
    }

    const { data, error, count } = await query;
    if (error) {
      toast({
        title: "Error loading bills",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setBills(data || []);
      setTotalCount(count || 0);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadBills();
  }, [page, filters]);

  const totalPages = Math.ceil(totalCount / ROWS_PER_PAGE);

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex gap-2 items-center">
        <Input
          placeholder="Search by Bill ID"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          className="max-w-xs"
        />
        <Button variant="outline" onClick={() => setPage(1)}>
          Apply
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-left">Bill ID</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">GST</th>
                <th className="p-2 text-right">Discount</th>
                <th className="p-2 text-center">Status</th>
                <th className="p-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => (
                <tr key={b.billid} className="border-t">
                  <td className="p-2">{b.billid}</td>
                  <td className="p-2">{b.customerid || "—"}</td>
                  <td className="p-2">
                    {b.orderdate ? new Date(b.orderdate).toLocaleString() : "—"}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.totalamount || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.gst_total || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₹{(b.discount_total || 0).toFixed(2)}
                  </td>
                  <td className="p-2 text-center">
                    {b.finalized ? "Finalized" : "Draft"}
                  </td>
                  <td className="p-2 text-center">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onEdit(b.billid)}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
              {bills.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-4 text-center text-muted-foreground"
                  >
                    No bills found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <div className="text-sm text-muted-foreground">
          Page {page} of {totalPages || 1}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
