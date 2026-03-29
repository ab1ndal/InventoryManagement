// src/admin/components/DiscountTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Pencil, Trash2, Code } from "lucide-react";

export default function DiscountTable({ onEdit, refresh }) {
  const [discounts, setDiscounts] = useState([]);

  useEffect(() => {
    fetchDiscounts();
  }, [refresh]);

  const handleDelete = async (id) => {
    const { error } = await supabase.from("discounts").delete().eq("id", id);
    if (!error) {
      fetchDiscounts();
    } else {
      console.error("Error deleting discount:", error.message);
    }
  };

  const discountTypeLabels = {
    percentage: "Percentage",
    fixed_price: "Fixed Price",
    buy_x_get_y: "Buy X Get Y",
    flat: "Flat Rate",
    conditional: "Conditional",
  };

  const formatCurrency = (v) =>
    Number(v || 0).toLocaleString("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    });

  const formatDates = (date) => {
    return date ? new Date(date).toLocaleDateString("en-IN") : "—";
  };

  // Open a dialog to show/edit the rules for a discount. The rules are stored in the rules column as JSON.
  const handleEditRules = (discount) => {
    // Open dialog
    console.log("Edit rules for discount:", discount.rules);
  };

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
        active,
        rules
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
            <th className="px-2 py-1 text-center">Code</th>
            <th className="px-2 py-1 text-center">Type</th>
            <th className="px-2 py-1 text-center">Value</th>
            <th className="px-2 py-1 text-center">Min Total</th>
            <th className="px-2 py-1 text-center">Max Discount</th>
            <th className="px-2 py-1 text-center">Category</th>
            <th className="px-2 py-1 text-center">Auto</th>
            <th className="px-2 py-1 text-center">Exclusive</th>
            <th className="px-2 py-1 text-center">Once/Customer</th>
            <th className="px-2 py-1 text-center">Start</th>
            <th className="px-2 py-1 text-center">End</th>
            <th className="px-2 py-1 text-center">Active</th>
            <th className="px-2 py-1 text-center">Action</th>
          </tr>
        </thead>
        <tbody>
          {discounts.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="px-2 py-1 text-center">{d.code || "—"}</td>
              <td className="px-2 py-1 text-center">
                {discountTypeLabels[d.type] || d.type}
              </td>
              <td className="px-2 py-1 text-center">
                {formatCurrency(d.value)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatCurrency(d.min_total)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatCurrency(d.max_discount)}
              </td>
              <td className="px-2 py-1 text-center">{d.category || "—"}</td>
              <td className="px-2 py-1 text-center">
                {d.auto_apply ? "Yes" : "No"}
              </td>
              <td className="px-2 py-1 text-center">
                {d.exclusive ? "Yes" : "No"}
              </td>
              <td className="px-2 py-1 text-center">
                {d.once_per_customer ? "Yes" : "No"}
              </td>
              <td className="px-2 py-1 text-center">
                {formatDates(d.start_date)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatDates(d.end_date)}
              </td>
              <td className="px-2 py-1 text-center">
                {d.active ? "Yes" : "No"}
              </td>
              <td className="px-3 py-1 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditRules(d)}
                >
                  <Code className="h-4 w-4 text-gray-500" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(d)}>
                  {/* Edit button - Color should be gold and hover should be blue*/}
                  <Pencil className="h-4 w-4 text-yellow-500 hover:text-blue-500" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDelete(d.id)}
                >
                  <Trash2 className="h-4 w-4 text-red-500 hover:text-red-700" />
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
