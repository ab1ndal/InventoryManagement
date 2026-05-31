import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";
import CategoriesPage from "./CategoriesPage";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../components/ui/tabs";
import { toast } from "../../components/hooks/use-toast";
import { formatINR } from "../../utility/formatCurrency";

const ROLES = [
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "superadmin", label: "Super Admin" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getFinancialYear(year, month) {
  // month is 0-indexed; April = 3
  return month >= 3 ? year : year - 1;
}

function MonthlySales() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMonthlySales();
  }, []);

  const fetchMonthlySales = async () => {
    setLoading(true);
    try {
      const { data: bills, error: billsError } = await supabase
        .from("bills")
        .select("billid, orderdate, net_amount, payment_amount");
      if (billsError) throw billsError;

      const { data: items, error: itemsError } = await supabase
        .from("bill_items")
        .select("billid, product_code, variantid, quantity");
      if (itemsError) throw itemsError;

      // Separate manual (BCX…) vs regular (BC…) items
      const manualCodes = [...new Set(
        items.filter((i) => i.product_code?.startsWith("BCX")).map((i) => i.product_code)
      )];
      const variantIds = [...new Set(
        items.filter((i) => !i.product_code?.startsWith("BCX") && i.variantid).map((i) => i.variantid)
      )];

      // Fetch purchase prices in parallel
      const [manualRes, variantRes] = await Promise.all([
        manualCodes.length > 0
          ? supabase.from("manual_items").select("manual_item_id, purchase_price").in("manual_item_id", manualCodes)
          : { data: [], error: null },
        variantIds.length > 0
          ? supabase.from("productsizecolors").select("variantid, products(purchaseprice)").in("variantid", variantIds)
          : { data: [], error: null },
      ]);
      if (manualRes.error) throw manualRes.error;
      if (variantRes.error) throw variantRes.error;

      const manualPriceMap = Object.fromEntries(
        (manualRes.data || []).map((r) => [r.manual_item_id, r.purchase_price || 0])
      );
      const variantPriceMap = Object.fromEntries(
        (variantRes.data || []).map((r) => [r.variantid, r.products?.purchaseprice || 0])
      );

      // Sum purchase cost per bill
      const purchaseByBill = {};
      for (const item of items) {
        const isManual = item.product_code?.startsWith("BCX");
        const unitPrice = isManual
          ? (manualPriceMap[item.product_code] || 0)
          : (variantPriceMap[item.variantid] || 0);
        const cost = unitPrice * (item.quantity || 0);
        purchaseByBill[item.billid] = (purchaseByBill[item.billid] || 0) + cost;
      }

      // Aggregate by month
      const monthMap = {};
      for (const bill of bills) {
        if (!bill.orderdate) continue;
        const d = new Date(bill.orderdate);
        const year = d.getFullYear();
        const month = d.getMonth(); // 0-indexed
        const key = `${year}-${String(month).padStart(2, "0")}`;
        if (!monthMap[key]) {
          monthMap[key] = { year, month, totalSales: 0, totalPurchase: 0 };
        }
        const sale = bill.net_amount != null ? bill.net_amount : (bill.payment_amount || 0);
        monthMap[key].totalSales += sale;
        monthMap[key].totalPurchase += purchaseByBill[bill.billid] || 0;
      }

      // Sort descending (newest first)
      const sorted = Object.values(monthMap).sort((a, b) =>
        b.year !== a.year ? b.year - a.year : b.month - a.month
      );
      setRows(sorted);
    } catch (err) {
      console.error("Error fetching monthly sales:", err);
      toast({ variant: "destructive", title: "Error", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-orange-600 border-opacity-50" />
      </div>
    );
  }

  let lastFY = null;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Total Sales</TableHead>
            <TableHead className="text-right">Total Purchase Cost</TableHead>
            <TableHead className="text-right">Profit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-gray-400 py-8">
                No sales data found.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const fy = getFinancialYear(row.year, row.month);
              const showSeparator = fy !== lastFY;
              lastFY = fy;
              const fyLabel = `FY ${fy}–${String(fy + 1).slice(-2)} (Apr ${fy} – Mar ${fy + 1})`;
              const profit = row.totalSales - row.totalPurchase;
              const profitPct = row.totalSales > 0
                ? ((profit / row.totalSales) * 100).toFixed(1)
                : "0.0";
              return (
                <React.Fragment key={`${row.year}-${row.month}`}>
                  {showSeparator && (
                    <TableRow className="bg-gray-100 border-t-2 border-gray-300">
                      <TableCell
                        colSpan={4}
                        className="py-2 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider"
                      >
                        {fyLabel}
                      </TableCell>
                    </TableRow>
                  )}
                  <TableRow>
                    <TableCell className="font-medium">
                      {MONTH_NAMES[row.month]} {row.year}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(row.totalSales)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatINR(row.totalPurchase)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatINR(profit)} ({profitPct}%)
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function UsersTab({ isSuperAdmin }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isFetching = useRef(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    if (isFetching.current) return;
    isFetching.current = true;
    try {
      setLoading(true);
      setError(null);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, role, is_active")
        .order("email");
      if (error) throw error;
      setUsers(data);
    } catch (error) {
      console.error("Error fetching users:", error);
      setError("Failed to fetch users. Please try again later.");
      toast({ variant: "destructive", title: "Error", description: error.message });
    } finally {
      setLoading(false);
      isFetching.current = false;
    }
  };

  const updateRole = async (userId, newRole) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);
      if (error) throw error;
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      toast({ title: "Success", description: "Role updated." });
    } catch (error) {
      console.error("Error updating role:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to update role." });
    }
  };

  const toggleActive = async (userId, currentActive) => {
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_active: !currentActive })
        .eq("id", userId);
      if (error) throw error;
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_active: !currentActive } : u))
      );
      toast({ title: "Success", description: currentActive ? "User deactivated." : "User reactivated." });
    } catch (error) {
      console.error("Error toggling active:", error);
      toast({ variant: "destructive", title: "Error", description: "Failed to update user status." });
    }
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-4 border-orange-600 border-opacity-50" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500 text-center py-4">{error}</div>;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            {isSuperAdmin && <TableHead>Change Role</TableHead>}
            {isSuperAdmin && <TableHead></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const inactive = user.is_active === false;
            const isSuperAdminRow = user.role === "superadmin";
            return (
              <TableRow key={user.id} className={inactive ? "opacity-40" : ""}>
                <TableCell>{user.email}</TableCell>
                <TableCell className="capitalize">{user.role === "superadmin" ? "Super Admin" : user.role}</TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${inactive ? "bg-gray-100 text-gray-500" : "bg-green-100 text-green-700"}`}>
                    {inactive ? "Inactive" : "Active"}
                  </span>
                </TableCell>
                {isSuperAdmin && (
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(newRole) => {
                        if (newRole !== user.role) updateRole(user.id, newRole);
                      }}
                    >
                      <SelectTrigger className="w-[150px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-200 shadow-md rounded-md">
                        {ROLES.map((role) => (
                          <SelectItem
                            key={role.value}
                            value={role.value}
                            className="bg-white border border-gray-200 shadow-md rounded-md"
                          >
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                )}
                {isSuperAdmin && (
                  <TableCell>
                    {!isSuperAdminRow && (
                      <button
                        onClick={() => toggleActive(user.id, user.is_active !== false)}
                        className={`text-xs px-3 py-1 rounded border font-medium transition ${
                          inactive
                            ? "border-green-500 text-green-600 hover:bg-green-50"
                            : "border-red-400 text-red-500 hover:bg-red-50"
                        }`}
                      >
                        {inactive ? "Reactivate" : "Deactivate"}
                      </button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function AdminPage() {
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      setIsSuperAdmin(data?.role === "superadmin");
    })();
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Admin</h2>
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          {isSuperAdmin && (
            <TabsTrigger value="monthly-sales">Monthly Sales</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="users">
          <UsersTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoriesPage />
        </TabsContent>
        {isSuperAdmin && (
          <TabsContent value="monthly-sales">
            <MonthlySales />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
