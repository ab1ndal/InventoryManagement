import React, { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";
import { toast } from "sonner";

const navItems = [
  { label: "Users", path: "/admin/users" },
  { label: "Inventory", path: "/admin/inventory" },
  { label: "Mockups", path: "/admin/mockups" },
  { label: "Bills", path: "/admin/bills" },
  { label: "Vouchers", path: "/admin/vouchers" },
  { label: "Discounts", path: "/admin/discounts" },
  { label: "Exchanges", path: "/admin/exchanges" },
  { label: "Customers", path: "/admin/customers" },
  { label: "Suppliers", path: "/admin/suppliers" },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState("");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) setUserEmail(user.email);
    })();
  }, []);

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
      <nav className="bg-white border-b shadow px-6 py-4 flex items-center justify-between">
        <div className="flex space-x-6">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `text-sm font-medium ${
                  isActive
                    ? "text-blue-600 border-b-2 border-blue-600 pb-1"
                    : "text-gray-600 hover:text-black"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* User Info and Logout */}
        <div className="flex items-center space-x-4 text-sm text-gray-600">
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
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
