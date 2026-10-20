import React, { useEffect } from "react";
import { Outlet, useLocation, useNavigationType } from "react-router-dom";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontFooter from "./StorefrontFooter";
import { CartProvider } from "../context/CartContext";
import { WishlistProvider } from "../context/WishlistContext";
import { StorefrontAuthProvider } from "../context/StorefrontAuthContext";
import CartDrawer from "./cart/CartDrawer";
import { initAnalytics, trackPageView } from "../lib/analytics";

export default function StorefrontLayout() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);

  // BrowserRouter keeps the old scroll position across links, so a category
  // or product clicked from far down a page opened mid-page. Back/forward
  // (POP) is left to the browser so returning to a list keeps its place.
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);

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
