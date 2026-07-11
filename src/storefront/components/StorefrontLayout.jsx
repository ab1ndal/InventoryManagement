import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontFooter from "./StorefrontFooter";
import { CartProvider } from "../context/CartContext";
import { WishlistProvider } from "../context/WishlistContext";
import { StorefrontAuthProvider } from "../context/StorefrontAuthContext";
import CartDrawer from "./cart/CartDrawer";
import { initAnalytics, trackPageView } from "../lib/analytics";

export default function StorefrontLayout() {
  const location = useLocation();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  return (
    <StorefrontAuthProvider>
      <CartProvider>
        <WishlistProvider>
          <div className="min-h-dvh bg-storefront-cream font-sans text-storefront-charcoal">
            <StorefrontHeader />
            <main>
              <Outlet />
            </main>
            <StorefrontFooter />
            <CartDrawer />
          </div>
        </WishlistProvider>
      </CartProvider>
    </StorefrontAuthProvider>
  );
}
