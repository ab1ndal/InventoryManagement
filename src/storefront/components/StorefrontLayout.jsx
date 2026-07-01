import React from "react";
import { Outlet } from "react-router-dom";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontFooter from "./StorefrontFooter";
import { CartProvider } from "../context/CartContext";
import CartDrawer from "./cart/CartDrawer";

export default function StorefrontLayout() {
  return (
    <CartProvider>
      <div className="min-h-dvh bg-storefront-cream font-sans text-storefront-charcoal">
        <StorefrontHeader />
        <main>
          <Outlet />
        </main>
        <StorefrontFooter />
        <CartDrawer />
      </div>
    </CartProvider>
  );
}
