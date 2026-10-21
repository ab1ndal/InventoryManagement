import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ShoppingBag, Menu, X, Search, User, Heart } from "lucide-react";
import { useCart } from "../context/CartContext";
import { useWishlist } from "../context/WishlistContext";
import { useStorefrontAuth } from "../context/StorefrontAuthContext";
import SearchOverlay from "./SearchOverlay";
import { NAV_LINKS, DRAWER_LINKS, PROMO_MESSAGES } from "../lib/siteConfig";

const PROMO_INTERVAL_MS = 4000;

const ICON_LINK =
  "relative p-2 text-storefront-charcoal hover:text-storefront-gold transition-colors cursor-pointer";
const BADGE =
  "absolute top-0.5 right-0.5 min-w-[16px] h-4 flex items-center justify-center bg-storefront-gold text-storefront-cream text-[9px] font-sans font-semibold rounded-full px-1 leading-none";

function prefersReducedMotion() {
  // jsdom and very old browsers lack matchMedia; treat as "no preference".
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function PromoMessage({ text, to, href }) {
  const cls = "underline-offset-4 hover:underline hover:text-white";
  if (to) return <Link to={to} className={cls}>{text}</Link>;
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {text}
      </a>
    );
  return <span>{text}</span>;
}

// Rotating action line. Pauses on hover/focus so a link can be clicked or
// read; reduced-motion visitors only ever see the first message.
function PromoLine() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion] = useState(prefersReducedMotion);

  useEffect(() => {
    if (paused || reduceMotion || PROMO_MESSAGES.length < 2) return undefined;
    const id = setInterval(
      () => setIndex((i) => (i + 1) % PROMO_MESSAGES.length),
      PROMO_INTERVAL_MS
    );
    return () => clearInterval(id);
  }, [paused, reduceMotion]);

  return (
    <section
      aria-label="Promotions"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="bg-storefront-charcoal text-storefront-cream text-center text-[11px] sm:text-xs py-2 px-4 tracking-wider"
    >
      <div aria-live="polite" aria-atomic="true" className="truncate">
        <PromoMessage {...PROMO_MESSAGES[index]} />
      </div>
    </section>
  );
}

const SHORTCUT_HINT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)
    ? "⌘K"
    : "Ctrl K";

function SearchBox({ onOpen, className = "" }) {
  return (
    <button
      type="button"
      aria-label="Search products"
      onClick={onOpen}
      className={`flex items-center gap-3 w-full h-10 px-4 bg-storefront-card border border-storefront-border rounded-md text-sm text-storefront-muted hover:border-storefront-gold transition-colors cursor-text ${className}`}
    >
      <Search size={17} className="flex-shrink-0 text-storefront-warm" aria-hidden="true" />
      <span className="flex-1 text-left truncate">Search sarees, lehengas, kurtis…</span>
      <kbd className="hidden lg:inline font-sans text-[10px] text-storefront-muted border border-storefront-border rounded px-1.5 py-0.5">
        {SHORTCUT_HINT}
      </kbd>
    </button>
  );
}

export default function StorefrontHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const { itemCount, openCart } = useCart();
  const { count: wishlistCount } = useWishlist();
  const { user } = useStorefrontAuth();

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Cmd/Ctrl-K toggles search, command-palette style.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 bg-storefront-cream font-sans transition-shadow duration-200 ${
        scrolled ? "shadow-sm" : ""
      }`}
    >
      <PromoLine />

      {/* Main row: logo · search · icons */}
      <div className="border-b border-storefront-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 md:h-[72px] flex items-center justify-between gap-4 lg:gap-8">
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Mobile hamburger */}
            <button
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
              className={`md:hidden -ml-2 ${ICON_LINK}`}
            >
              {menuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>

            <Link to="/" className="flex items-center gap-2.5">
              {/* Monogram only: the full logo's filigree shrinks the "BC" to
                  illegible at header height. rem sizing so it scales with zoom. */}
              <img
                src="/logo-monogram.png"
                alt="Bindal's Creations"
                width={256}
                height={256}
                className="h-11 w-11 md:h-14 md:w-14 object-contain"
              />
              <span className="hidden sm:block font-display font-semibold text-lg md:text-xl text-storefront-charcoal leading-tight">
                Bindal's<br />
                <span className="text-storefront-gold">Creations</span>
              </span>
            </Link>
          </div>

          <SearchBox
            onOpen={() => setSearchOpen(true)}
            className="hidden md:flex max-w-xl"
          />

          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <Link to="/wishlist" aria-label="Wishlist" className={ICON_LINK}>
              <Heart size={20} />
              {wishlistCount > 0 && (
                <span className={BADGE}>{wishlistCount > 99 ? "99+" : wishlistCount}</span>
              )}
            </Link>

            <Link
              to={user ? "/account" : "/login"}
              aria-label={user ? "Account" : "Sign in"}
              className={ICON_LINK}
            >
              <User size={20} />
            </Link>

            <button aria-label="Cart" onClick={openCart} className={ICON_LINK}>
              <ShoppingBag size={20} />
              {itemCount > 0 && (
                <span className={BADGE}>{itemCount > 99 ? "99+" : itemCount}</span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile search row */}
        <div className="md:hidden px-4 pb-2.5">
          <SearchBox onOpen={() => setSearchOpen(true)} className="h-9" />
        </div>
      </div>

      {/* Desktop category row */}
      <nav
        aria-label="Categories"
        className="hidden md:block border-b border-storefront-border bg-storefront-card"
      >
        <ul className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-11 flex items-center justify-center gap-6 lg:gap-9">
          {NAV_LINKS.map(({ label, to, highlight }) => (
            <li key={label}>
              <Link
                to={to}
                className={`text-[13px] tracking-wide transition-colors duration-150 ${
                  highlight
                    ? "font-semibold text-storefront-gold hover:text-storefront-gold-dark"
                    : "font-medium text-storefront-charcoal hover:text-storefront-gold"
                }`}
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile drawer */}
      {menuOpen && (
        <nav
          aria-label="Mobile menu"
          className="md:hidden bg-storefront-cream border-b border-storefront-border max-h-[calc(100dvh-8rem)] overflow-y-auto"
        >
          <ul className="flex flex-col px-4 py-2">
            {[...NAV_LINKS, ...DRAWER_LINKS].map(({ label, to, highlight }, i) => (
              <li
                key={label}
                className={`border-b border-storefront-border last:border-0 ${
                  i === NAV_LINKS.length ? "border-t-4 border-t-storefront-border/60" : ""
                }`}
              >
                <Link
                  to={to}
                  className={`block py-3 px-2 text-sm transition-colors ${
                    highlight
                      ? "font-semibold text-storefront-gold"
                      : "font-medium text-storefront-charcoal hover:text-storefront-gold"
                  }`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  );
}
