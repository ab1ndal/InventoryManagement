import React from "react";
import { NavLink, Outlet } from "react-router-dom";

const navItems = [
  { label: "Inventory", path: "/admin/inventory" },
  { label: "Sales", path: "/admin/sales" },
  { label: "Customers", path: "/admin/customers" },
  { label: "Suppliers", path: "/admin/suppliers" },
];

export default function AdminLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Top Navigation */}
      <nav className="bg-white border-b shadow px-6 py-4 flex space-x-6">
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
      </nav>

      {/* Content Area */}
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
