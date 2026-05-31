import React, { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
} from "react-router-dom";
import StorefrontLayout from "./storefront/components/StorefrontLayout";
import HomePage from "./storefront/pages/HomePage";
import ShopPage from "./storefront/pages/ShopPage";
import ProductDetailPage from "./storefront/pages/ProductDetailPage";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import { Toaster } from "sonner";
import "react-datepicker/dist/react-datepicker.css";
import { TooltipProvider } from "components/ui/tooltip";

const AdminLayout = lazy(() => import("./admin/components/AdminLayout"));
const InventoryPage = lazy(() => import("./admin/pages/InventoryPage"));
const BillingPage = lazy(() => import("./admin/pages/BillingPage"));
const VoucherPage = lazy(() => import("./admin/pages/VoucherPage"));
const DiscountPage = lazy(() => import("./admin/pages/DiscountPage"));
const ExchangePage = lazy(() => import("./admin/pages/ExchangePage"));
const CustomersPage = lazy(() => import("./admin/pages/CustomersPage"));
const SuppliersPage = lazy(() => import("./admin/pages/SuppliersPage"));
const LoginPage = lazy(() => import("./admin/pages/LoginPage"));
const RequireAdminAuth = lazy(() => import("./admin/components/RequireAdminAuth"));
const UserManagement = lazy(() => import("./admin/pages/UserManagement"));
const SignupPage = lazy(() => import("./admin/pages/SignupPage"));
const ForgetPasswordPage = lazy(() => import("./admin/pages/ForgetPasswordPage"));
const ResetPasswordPage = lazy(() => import("./admin/pages/ResetPasswordPage"));
const MockupPage = lazy(() => import("./admin/pages/MockupPage"));

function App() {
  return (
    <TooltipProvider>
      <Router>
        <Suspense fallback={null}>
        <Routes>
          {/* Storefront */}
          <Route path="/" element={<StorefrontLayout />}>
            <Route index element={<HomePage />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="product/:productid" element={<ProductDetailPage />} />
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
        </Suspense>
      </Router>
      <Toaster position="bottom-right" richColors closeButton duration={2000} />
    </TooltipProvider>
  );
}

export default App;
