import React from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
} from "react-router-dom";
import StorefrontLayout from "./storefront/components/StorefrontLayout";
import HomePage from "./storefront/pages/HomePage";
import ShopPage from "./storefront/pages/ShopPage";
import AdminLayout from "./admin/components/AdminLayout";
import InventoryPage from "./admin/pages/InventoryPage";
import BillingPage from "./admin/pages/BillingPage";
import VoucherPage from "./admin/pages/VoucherPage";
import DiscountPage from "./admin/pages/DiscountPage";
import ExchangePage from "./admin/pages/ExchangePage";
import CustomersPage from "./admin/pages/CustomersPage";
import SuppliersPage from "./admin/pages/SuppliersPage";
import LoginPage from "./admin/pages/LoginPage";
import RequireAdminAuth from "./admin/components/RequireAdminAuth";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import UserManagement from "./admin/pages/UserManagement";
import SignupPage from "./admin/pages/SignupPage";
import ForgetPasswordPage from "./admin/pages/ForgetPasswordPage";
import ResetPasswordPage from "./admin/pages/ResetPasswordPage";
import { Toaster } from "sonner";
import "react-datepicker/dist/react-datepicker.css";
import { TooltipProvider } from "components/ui/tooltip";
import MockupPage from "./admin/pages/MockupPage";

function App() {
  return (
    <TooltipProvider>
      <Router>
        <Routes>
          {/* Storefront */}
          <Route path="/" element={<StorefrontLayout />}>
            <Route index element={<HomePage />} />
            <Route path="shop" element={<ShopPage />} />
          </Route>

          {/* Public Pages */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/admin/login" element={<LoginPage />} />
          <Route path="/admin/signup" element={<SignupPage />} />
          <Route
            path="/admin/forgot-password"
            element={<ForgetPasswordPage />}
          />
          <Route path="/admin/reset-password" element={<ResetPasswordPage />} />

          {/* Protected Admin Routes */}
          <Route path="/admin" element={<RequireAdminAuth />}>
            <Route element={<AdminLayout />}>
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="bills" element={<BillingPage />} />
              <Route path="vouchers" element={<VoucherPage />} />
              <Route path="discounts" element={<DiscountPage />} />
              <Route path="exchanges" element={<ExchangePage />} />
              <Route path="mockups" element={<MockupPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="users" element={<UserManagement />} />
            </Route>
          </Route>
        </Routes>
      </Router>
      <Toaster position="bottom-right" richColors closeButton duration={2000} />
    </TooltipProvider>
  );
}

export default App;
