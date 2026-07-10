import React, { useState, useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ShoppingBag, Menu, X } from "lucide-react";
import { useCart } from "../context/CartContext";

const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Shop", to: "/shop" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

export default function StorefrontHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { itemCount, openCart } = useCart();

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-storefront-cream font-sans transition-shadow duration-200 ${
        scrolled ? "shadow-sm" : ""
      }`}
    >
      {/* Announcement bar */}
      <div className="bg-storefront-charcoal text-storefront-cream text-center text-xs py-2 px-4 tracking-widest uppercase">
        Free shipping on orders above ₹5,000
      </div>

      {/* Main header */}
      <div className="border-b border-storefront-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 flex-shrink-0">
            <img
              src="/LOGO-BindalsCreation.png"
              alt="Bindal's Creations"
              className="h-10 w-auto object-contain"
            />
            <span className="hidden sm:block font-display font-semibold text-xl text-storefront-charcoal leading-tight">
              Bindal's<br />
              <span className="text-storefront-gold">Creations</span>
            </span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map(({ label, to }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `text-sm font-medium tracking-wide transition-colors duration-150 relative after:absolute after:bottom-[-2px] after:left-0 after:h-[1.5px] after:bg-storefront-gold after:transition-all after:duration-200 ${
                    isActive
                      ? "text-storefront-gold after:w-full"
                      : "text-storefront-charcoal hover:text-storefront-gold after:w-0 hover:after:w-full"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              aria-label="Cart"
              onClick={openCart}
              className="relative p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors cursor-pointer"
            >
              <ShoppingBag size={20} />
              {itemCount > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center bg-storefront-gold text-storefront-cream text-[9px] font-sans font-semibold rounded-full px-1 leading-none">
                  {itemCount > 99 ? "99+" : itemCount}
                </span>
              )}
            </button>

            {/* Mobile hamburger */}
            <button
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((o) => !o)}
              className="md:hidden p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors cursor-pointer"
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-storefront-cream border-b border-storefront-border">
          <nav className="flex flex-col px-4 py-3 gap-1">
            {NAV_LINKS.map(({ label, to }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `py-3 px-2 text-sm font-medium border-b border-storefront-border last:border-0 transition-colors ${
                    isActive
                      ? "text-storefront-gold"
                      : "text-storefront-charcoal hover:text-storefront-gold"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
