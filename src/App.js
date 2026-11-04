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
import AboutPage from "./storefront/pages/AboutPage";
import AllProductsPage from "./storefront/pages/AllProductsPage";
import CustomizePage from "./storefront/pages/CustomizePage";
import ContactPage from "./storefront/pages/ContactPage";
import SizeGuidePage from "./storefront/pages/SizeGuidePage";
import CollectionsIndexPage from "./storefront/pages/CollectionsIndexPage";
import CollectionPage from "./storefront/pages/CollectionPage";
import UnauthorizedPage from "./pages/UnauthorizedPage";
import { Toaster } from "sonner";
import "react-datepicker/dist/react-datepicker.css";
import { TooltipProvider } from "components/ui/tooltip";
import RouteErrorBoundary from "components/RouteErrorBoundary";
import { lazyWithReload } from "lib/lazyWithReload";

const AdminLayout = lazy(() => import("./admin/components/AdminLayout"));
const InventoryPage = lazy(() => import("./admin/pages/InventoryPage"));
const BillingPage = lazy(() => import("./admin/pages/BillingPage"));
const VoucherPage = lazy(() => import("./admin/pages/VoucherPage"));
const DiscountPage = lazy(() => import("./admin/pages/DiscountPage"));
const ExchangePage = lazy(() => import("./admin/pages/ExchangePage"));
const CustomersPage = lazy(() => import("./admin/pages/CustomersPage"));
const SuppliersPage = lazy(() => import("./admin/pages/SuppliersPage"));
const AdminLoginPage = lazy(() => import("./admin/pages/LoginPage"));
const RequireAdminAuth = lazy(() => import("./admin/components/RequireAdminAuth"));
const AdminPage = lazy(() => import("./admin/pages/AdminPage"));
const ForgetPasswordPage = lazy(() => import("./admin/pages/ForgetPasswordPage"));
const ResetPasswordPage = lazy(() => import("./admin/pages/ResetPasswordPage"));
const MockupPage = lazy(() => import("./admin/pages/MockupPage"));
const DashboardPage = lazy(() => import("./admin/pages/DashboardPage"));
const HistoryPage = lazy(() => import("./admin/pages/HistoryPage"));
const OnlineOrdersPage = lazy(() => import("./admin/pages/OnlineOrdersPage"));

// Pages no search visitor lands on: they stay out of the first download, which also keeps zod and
// react-hook-form away from shoppers who never reach checkout. Public pages stay eager, because a late
// page would shift the layout that Google scores.
const CartPage = lazyWithReload(() => import("./storefront/pages/CartPage"));
const CheckoutPage = lazyWithReload(() => import("./storefront/pages/CheckoutPage"));
const WishlistPage = lazyWithReload(() => import("./storefront/pages/WishlistPage"));
const LoginPage = lazyWithReload(() => import("./storefront/pages/LoginPage"));
const AccountPage = lazyWithReload(() => import("./storefront/pages/AccountPage"));
const AccountOrdersPage = lazyWithReload(() => import("./storefront/pages/AccountOrdersPage"));
const SearchResultsPage = lazyWithReload(() => import("./storefront/pages/SearchResultsPage"));
const TrackOrderPage = lazyWithReload(() => import("./storefront/pages/TrackOrderPage"));
const OrderPage = lazyWithReload(() => import("./storefront/pages/OrderPage"));
const RefundChoicePage = lazyWithReload(() => import("./storefront/pages/RefundChoicePage"));

// Keeps the header in place and the footer below the fold while the page's code arrives.
function PrivatePage({ children }) {
  return <Suspense fallback={<div className="min-h-screen" />}>{children}</Suspense>;
}

function App() {
  return (
    <TooltipProvider>
      <Router>
        {/* Last resort: the layouts' own boundaries keep their menus on screen for a failed page. */}
        <RouteErrorBoundary>
        <Suspense fallback={null}>
        <Routes>
          {/* Storefront */}
          <Route path="/" element={<StorefrontLayout />}>
            <Route index element={<HomePage />} />
            <Route path="shop" element={<ShopPage />} />
            <Route path="cart" element={<PrivatePage><CartPage /></PrivatePage>} />
            <Route path="checkout" element={<PrivatePage><CheckoutPage /></PrivatePage>} />
            <Route path="wishlist" element={<PrivatePage><WishlistPage /></PrivatePage>} />
            <Route path="product/:productid" element={<ProductDetailPage />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="policies/shipping" element={<ShippingPolicyPage />} />
            <Route path="policies/returns" element={<ReturnsPolicyPage />} />
            <Route path="policies/privacy" element={<PrivacyPolicyPage />} />
            <Route path="policies/terms" element={<TermsPage />} />
            <Route path="about" element={<AboutPage />} />
            <Route path="all-products" element={<AllProductsPage />} />
            <Route path="customize" element={<CustomizePage />} />
            <Route path="contact" element={<ContactPage />} />
            <Route path="size-guide" element={<SizeGuidePage />} />
            <Route path="login" element={<PrivatePage><LoginPage /></PrivatePage>} />
            <Route path="account" element={<PrivatePage><AccountPage /></PrivatePage>} />
            <Route path="account/orders" element={<PrivatePage><AccountOrdersPage /></PrivatePage>} />
            <Route path="search" element={<PrivatePage><SearchResultsPage /></PrivatePage>} />
            <Route path="collections" element={<CollectionsIndexPage />} />
            <Route path="collections/:slug" element={<CollectionPage />} />
            <Route path="track" element={<PrivatePage><TrackOrderPage /></PrivatePage>} />
            <Route path="order/:ref" element={<PrivatePage><OrderPage /></PrivatePage>} />
            <Route path="refund-choice/:token" element={<PrivatePage><RefundChoicePage /></PrivatePage>} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* Public Pages */}
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/admin/login" element={<AdminLoginPage />} />
          <Route path="/admin/signup" element={<Navigate to="/admin/login" replace />} />
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
              <Route path="online-orders" element={<OnlineOrdersPage />} />
              <Route path="online-orders/:orderId" element={<OnlineOrdersPage />} />
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
        </RouteErrorBoundary>
      </Router>
      <Toaster position="bottom-right" richColors closeButton duration={2000} />
    </TooltipProvider>
  );
}

export default App;
