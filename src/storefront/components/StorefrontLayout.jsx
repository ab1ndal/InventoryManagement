import React from "react";
import { Outlet } from "react-router-dom";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontFooter from "./StorefrontFooter";

export default function StorefrontLayout() {
  return (
    <div className="min-h-dvh bg-storefront-cream font-montserrat text-storefront-charcoal">
      <StorefrontHeader />
      <main>
        <Outlet />
      </main>
      <StorefrontFooter />
    </div>
  );
}
