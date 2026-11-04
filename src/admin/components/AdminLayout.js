import React, { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";
import { countQueue } from "./onlineOrders/onlineOrdersApi";
import { lastCheckedRole } from "../lib/adminAccess";
import { Toaster } from "../../components/ui/toaster";
import RouteErrorBoundary from "../../components/RouteErrorBoundary";
import { keepErrorToastsUntilDismissed } from "../lib/stickyErrorToasts";

const navItems = [
  { label: "Dashboard", path: "/admin/dashboard", superadminOnly: true },
  { label: "History", path: "/admin/history", superadminOnly: true },
  { label: "Admin", path: "/admin/admin-hub" },
  { label: "Inventory", path: "/admin/inventory" },
  { label: "Mockups", path: "/admin/mockups" },
  { label: "Bills", path: "/admin/bills" },
  { label: "Online Orders", path: "/admin/online-orders", badge: "ordersNeedingAction" },
  { label: "Vouchers", path: "/admin/vouchers" },
  { label: "Discounts", path: "/admin/discounts" },
  { label: "Exchanges", path: "/admin/exchanges" },
  { label: "Customers", path: "/admin/customers" },
  { label: "Suppliers", path: "/admin/suppliers" },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState("");
  const [userRole, setUserRole] = useState(null);
  const [ordersNeedingAction, setOrdersNeedingAction] = useState(0);

  // Error messages stay on screen in the admin area until closed.
  useEffect(() => keepErrorToastsUntilDismissed(), []);

  useEffect(() => {
    (async () => {
      // The route guard has already verified this session, and these only label the menu.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (user) {
        setUserEmail(user.email);
        const checkedRole = lastCheckedRole(user.id);
        if (checkedRole) {
          setUserRole(checkedRole);
          return;
        }
        const { data } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        setUserRole(data?.role ?? null);
      }
    })();
  }, []);

  // Same count as the Needs action tab; refreshed whenever the tab regains focus or the
  // Online Orders page changes an order.
  const refreshOrdersNeedingAction = useCallback(
    () =>
      countQueue("needs_action")
        .then(setOrdersNeedingAction)
        .catch((err) => console.error("[AdminLayout] online order count failed:", err.message)),
    []
  );

  useEffect(() => {
    refreshOrdersNeedingAction();
    window.addEventListener("focus", refreshOrdersNeedingAction);
    return () => window.removeEventListener("focus", refreshOrdersNeedingAction);
  }, [refreshOrdersNeedingAction]);

  const badgeCounts = { ordersNeedingAction };

  const visibleNavItems = navItems.filter(
    (item) => !item.superadminOnly || userRole === "superadmin"
  );

  useEffect(() => {
    const toastData = JSON.parse(sessionStorage.getItem("toastData"));
    if (toastData) {
      toast(toastData.title, {
        description: toastData.description,
        icon: toastData.icon,
      });
      sessionStorage.removeItem("toastData");
    }
  }, []);

  const handleLogout = async () => {
    sessionStorage.setItem(
      "toastData",
      JSON.stringify({
        title: "Logout Success",
        description: "Logged out successfully.",
        icon: "✅",
      })
    );
    await supabase.auth.signOut();
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top Navigation Bar */}
      <nav className="sticky top-0 z-40 bg-white border-b shadow px-3 sm:px-6 py-4 flex items-center gap-3 sm:gap-6">
        <div className="flex space-x-6 overflow-x-auto whitespace-nowrap flex-1 min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `text-sm font-medium shrink-0 ${
                  isActive
                    ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                    : "text-gray-600 hover:text-black"
                }`
              }
            >
              {item.label}
              {item.badge && badgeCounts[item.badge] > 0 && (
                <span
                  className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white"
                  aria-label={`${badgeCounts[item.badge]} need action`}
                >
                  {badgeCounts[item.badge]}
                </span>
              )}
            </NavLink>
          ))}
        </div>

        {/* User Info and Logout */}
        <div className="flex items-center space-x-4 text-sm text-gray-600 shrink-0">
          {userEmail && <span className="hidden sm:inline">{userEmail}</span>}
          <button
            onClick={handleLogout}
            className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Content Area */}
      <main className="flex-1 p-2 sm:p-6">
        <RouteErrorBoundary>
          <Outlet context={{ refreshOrdersNeedingAction }} />
        </RouteErrorBoundary>
      </main>
      <Toaster />
    </div>
  );
}
