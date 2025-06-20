import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import AdminLayout from "./admin/components/AdminLayout";
import InventoryPage from "./admin/pages/InventoryPage";
import SalesPage from "./admin/pages/SalesPage";
import CustomersPage from "./admin/pages/CustomersPage";
import SuppliersPage from "./admin/pages/SuppliersPage";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/admin/inventory" />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="suppliers" element={<SuppliersPage />} />
        </Route>
        {/* Future customer-facing routes can go here */}
      </Routes>
    </Router>
  );
}

export default App;
