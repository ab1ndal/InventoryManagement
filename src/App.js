import React, { lazy, Suspense } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import StorefrontLayout from "./storefront/components/StorefrontLayout";
import HomePage from "./storefront/pages/HomePage";
import ShopPage from "./storefront/pages/ShopPage";
import ProductDetailPage from "./storefront/pages/ProductDetailPage";
import FaqPage from "./storefront/pages/FaqPage";
import NotFoundPage from "./storefront/pages/NotFoundPage";
import ShippingPolicyPage from "./storefront/pages/policies/ShippingPolicyPage";
import ReturnsPolicyPage from "./storefront/pages/policies/ReturnsPolicyPage";
import PrivacyPolicyPage from "./storefront/pages/policies/PrivacyPolicyPage";
import TermsPage from "./storefront/pages/policies/TermsPage";
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
const AdminPage = lazy(() => import("./admin/pages/AdminPage"));
const SignupPage = lazy(() => import("./admin/pages/SignupPage"));
const ForgetPasswordPage = lazy(() => import("./admin/pages/ForgetPasswordPage"));
const ResetPasswordPage = lazy(() => import("./admin/pages/ResetPasswordPage"));
const MockupPage = lazy(() => import("./admin/pages/MockupPage"));
const DashboardPage = lazy(() => import("./admin/pages/DashboardPage"));
const HistoryPage = lazy(() => import("./admin/pages/HistoryPage"));

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
            <Route path="faq" element={<FaqPage />} />
            <Route path="policies/shipping" element={<ShippingPolicyPage />} />
            <Route path="policies/returns" element={<ReturnsPolicyPage />} />
            <Route path="policies/privacy" element={<PrivacyPolicyPage />} />
            <Route path="policies/terms" element={<TermsPage />} />
            <Route path="*" element={<NotFoundPage />} />
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
              <Route index element={<Navigate to="/admin/inventory" replace />} />
              <Route element={<RequireAdminAuth allowedRoles={["superadmin"]} />}>
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="history" element={<HistoryPage />} />
              </Route>
              <Route path="inventory" element={<InventoryPage />} />
              <Route path="bills" element={<BillingPage />} />
              <Route path="vouchers" element={<VoucherPage />} />
              <Route path="discounts" element={<DiscountPage />} />
              <Route path="exchanges" element={<ExchangePage />} />
              <Route path="mockups" element={<MockupPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="admin-hub" element={<AdminPage />} />
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
