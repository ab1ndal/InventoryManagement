// src/admin/components/DiscountTable.js
import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { Button } from "../../components/ui/button";
import { Pencil, Trash2, Code } from "lucide-react";
import { formatINR } from "../../utility/formatCurrency";
import { formatDate } from "../../utility/dateFormat";
import { logActivity } from "../../lib/activityLog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog";
import { toast } from "sonner";

// Usage is recorded in three places: bills and orders hold the code as plain text, so nothing
// in the database stops a delete. Any failed check throws, so an unknown answer never allows one.
async function isDiscountCodeUsed(code) {
  if (!code) return false;
  const checks = await Promise.all([
    supabase.from("discount_usage").select("id").eq("code", code).limit(1),
    // Quoted as an array element, so a code containing a comma is still one code.
    supabase.from("bills").select("billid").filter("applied_codes", "cs", `{${JSON.stringify(code)}}`).limit(1),
    supabase.from("orders").select("id").eq("promo_code", code).limit(1),
  ]);
  const failed = checks.find((check) => check.error);
  if (failed) throw failed.error;
  return checks.some((check) => check.data?.length > 0);
}

export default function DiscountTable({ onEdit, refresh }) {
  const [discounts, setDiscounts] = useState([]);
  const [categoryMap, setCategoryMap] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    supabase
      .from("categories")
      .select("categoryid, name")
      .then(({ data }) => {
        if (data) setCategoryMap(Object.fromEntries(data.map((c) => [c.categoryid, c.name])));
      });
  }, []);

  useEffect(() => {
    fetchDiscounts();
  }, [refresh]);

  const handleSetActive = async (discount, active) => {
    const name = discount.code || "Discount";
    const { error } = await supabase.from("discounts").update({ active }).eq("id", discount.id);
    if (error) {
      toast.error(`Could not switch ${active ? "on" : "off"} ${name}`, { description: error.message });
      return;
    }
    logActivity({ action: "update", entityType: "discount", entityId: discount.id, summary: `Switched ${active ? "on" : "off"} discount code ${name}` });
    setDiscounts((prev) => prev.map((d) => (d.id === discount.id ? { ...d, active } : d)));
    toast.success(`${name} switched ${active ? "on" : "off"}`);
  };

  // Only a code that was never used can be deleted. Deleting a used one would also remove its usage history.
  const handleDeleteClick = async (discount) => {
    try {
      if (await isDiscountCodeUsed(discount.code)) {
        toast.error(`${discount.code} has been used, so it cannot be deleted`, {
          description: "Switch it off instead.",
        });
        return;
      }
      setDeleteTarget(discount);
    } catch (e) {
      toast.error("Could not check whether this code has been used", { description: e.message });
    }
  };

  const handleConfirmDelete = async () => {
    const { id, code } = deleteTarget;
    setDeleting(true);
    const { error } = await supabase.from("discounts").delete().eq("id", id);
    setDeleting(false);
    if (error) {
      toast.error(`Could not delete ${code || "discount"}`, { description: error.message });
      return;
    }
    logActivity({ action: "delete", entityType: "discount", entityId: id, summary: `Deleted discount code ${code || id}` });
    toast.success(`${code || "Discount"} deleted`);
    setDeleteTarget(null);
    fetchDiscounts();
  };

  const discountTypeLabels = {
    percentage: "Percentage",
    fixed_price: "Fixed Price",
    buy_x_get_y: "Buy X Get Y",
    flat: "Flat Rate",
    conditional: "Conditional",
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
        rules,
        storefront_redeemable
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
            <tr key={d.id} className="border-t hover:bg-gray-70">
              <td className="px-2 py-1 text-center">
                {d.code || "—"}
                {d.storefront_redeemable && (
                  <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
                    Web
                  </span>
                )}
              </td>
              <td className="px-2 py-1 text-center">
                {discountTypeLabels[d.type] || d.type}
              </td>
              <td className="px-2 py-1 text-center">
                {formatINR(d.value)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatINR(d.min_total)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatINR(d.max_discount)}
              </td>
              <td className="px-2 py-1 text-center">{d.category ? (categoryMap[d.category] || d.category) : "—"}</td>
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
                {formatDate(d.start_date)}
              </td>
              <td className="px-2 py-1 text-center">
                {formatDate(d.end_date)}
              </td>
              <td className="px-2 py-1 text-center">
                {d.active ? "Yes" : "No"}
              </td>
              <td className="px-3 py-1 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditRules(d)}
                  className="group"
                >
                  <Code className="h-4 w-4 text-gray-400 group-hover:text-gray-900 transition-colors duration-200" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(d)}
                  className="group"
                >
                  <Pencil className="h-4 w-4 text-yellow-500 group-hover:text-blue-500 transition-colors duration-200" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleSetActive(d, !d.active)}
                >
                  {d.active ? "Switch off" : "Switch on"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDeleteClick(d)}
                  className="group"
                  title="Delete (only if never used)"
                  aria-label={`Delete ${d.code || "discount"}`}
                >
                  <Trash2 className="h-4 w-4 text-red-500 group-hover:text-red-700 transition-colors duration-200" />
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

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <DialogContent className="bg-white max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.code || "this discount"}?</DialogTitle>
            <DialogDescription>
              It has never been used. It will be removed for good.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Keep
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleConfirmDelete}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
