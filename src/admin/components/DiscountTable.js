// src/admin/components/DiscountTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";

export default function DiscountTable({ onEdit, refresh }) {
  const [discounts, setDiscounts] = useState([]);

  useEffect(() => {
    fetchDiscounts();
  }, [refresh]);

  const fetchDiscounts = async () => {
    const { data, error } = await supabase.from("discounts").select(`
        id,
        code,
        type,
        value,
        max_discount,
        category,
        once_per_customer,
        exclusive,
        auto_apply,
        min_total,
        start_date,
        end_date,
        active
      `);

    if (!error) {
      setDiscounts(data);
    } else {
      console.error("Error loading discounts:", error.message);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full border text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-2 py-1 text-left">Code</th>
            <th className="px-2 py-1 text-left">Type</th>
            <th className="px-2 py-1 text-left">Value</th>
            <th className="px-2 py-1 text-left">Min Total</th>
            <th className="px-2 py-1 text-left">Max Discount</th>
            <th className="px-2 py-1 text-left">Category</th>
            <th className="px-2 py-1 text-left">Auto</th>
            <th className="px-2 py-1 text-left">Exclusive</th>
            <th className="px-2 py-1 text-left">Once/Customer</th>
            <th className="px-2 py-1 text-left">Start</th>
            <th className="px-2 py-1 text-left">End</th>
            <th className="px-2 py-1 text-left">Active</th>
            <th className="px-2 py-1 text-left">Action</th>
          </tr>
        </thead>
        <tbody>
          {discounts.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="px-2 py-1">{d.code || "—"}</td>
              <td className="px-2 py-1">{d.type}</td>
              <td className="px-2 py-1">{d.value}</td>
              <td className="px-2 py-1">{d.min_total}</td>
              <td className="px-2 py-1">{d.max_discount || "—"}</td>
              <td className="px-2 py-1">{d.category || "—"}</td>
              <td className="px-2 py-1">{d.auto_apply ? "Yes" : "No"}</td>
              <td className="px-2 py-1">{d.exclusive ? "Yes" : "No"}</td>
              <td className="px-2 py-1">
                {d.once_per_customer ? "Yes" : "No"}
              </td>
              <td className="px-2 py-1">{d.start_date || "—"}</td>
              <td className="px-2 py-1">{d.end_date || "—"}</td>
              <td className="px-2 py-1">{d.active ? "Yes" : "No"}</td>
              <td className="px-2 py-1">
                <Button variant="outline" size="sm" onClick={() => onEdit(d)}>
                  Edit
                </Button>
              </td>
            </tr>
          ))}
          {discounts.length === 0 && (
            <tr>
              <td
                className="px-2 py-4 text-center text-muted-foreground"
                colSpan={13}
              >
                No discounts found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
