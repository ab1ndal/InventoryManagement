import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CartProvider } from "../context/CartContext";
import { WishlistProvider } from "../context/WishlistContext";
import StorefrontHeader from "../components/StorefrontHeader";
import { NAV_LINKS, PROMO_MESSAGES } from "../lib/siteConfig";

jest.mock("../context/StorefrontAuthContext", () => ({
  useStorefrontAuth: () => ({ user: null }),
}));

jest.mock("lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
      getUser: () => Promise.resolve({ data: { user: null } }),
    },
  },
}));

function renderHeader() {
  render(
    <MemoryRouter>
      <CartProvider>
        <WishlistProvider>
          <StorefrontHeader />
        </WishlistProvider>
      </CartProvider>
    </MemoryRouter>
  );
}

describe("StorefrontHeader", () => {
  it("links to About and Contact from the mobile drawer", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("navigation", { name: "Mobile menu" });
    expect(within(drawer).getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(within(drawer).getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
  });

  it("lists every NAV_LINKS entry in the drawer", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const drawer = screen.getByRole("navigation", { name: "Mobile menu" });
    NAV_LINKS.forEach(({ label, to }) => {
      expect(within(drawer).getByRole("link", { name: label })).toHaveAttribute("href", to);
    });
  });

  it("renders the category row with a highlighted Diwali Edit link", () => {
    renderHeader();
    const row = screen.getByRole("navigation", { name: "Categories" });
    NAV_LINKS.forEach(({ label, to }) => {
      expect(within(row).getByRole("link", { name: label })).toHaveAttribute("href", to);
    });
    const diwali = within(row).getByRole("link", { name: "Diwali Edit" });
    expect(diwali).toHaveAttribute("href", "/collections/diwali");
    expect(diwali.className).toMatch(/text-storefront-gold/);
  });

  it("opens the search overlay from the search box", () => {
    renderHeader();
    expect(screen.queryByRole("dialog", { name: /search products/i })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /search/i })[0]);
    expect(screen.getByRole("dialog", { name: /search products/i })).toBeInTheDocument();
  });

  it("toggles the search overlay with Ctrl-K", () => {
    renderHeader();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: /search products/i })).toBeInTheDocument();
  });

  it("shows an account link for signed-out visitors", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: /account|sign in/i })).toHaveAttribute("href", "/login");
  });
});

describe("StorefrontHeader promo line", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
  });

  function promo() {
    return screen.getByRole("region", { name: "Promotions" });
  }

  it("starts on the first message in a polite live region", () => {
    renderHeader();
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[0].text);
    expect(promo().querySelector("[aria-live='polite']")).not.toBeNull();
  });

  it("rotates to the next message every 4 seconds and wraps", () => {
    renderHeader();
    act(() => jest.advanceTimersByTime(4000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[1].text);
    expect(within(promo()).getByRole("link", { name: PROMO_MESSAGES[1].text })).toHaveAttribute(
      "href",
      "/collections/diwali"
    );
    act(() => jest.advanceTimersByTime(4000));
    expect(within(promo()).getByRole("link", { name: PROMO_MESSAGES[2].text })).toHaveAttribute(
      "href",
      "https://wa.me/919810873280"
    );
    act(() => jest.advanceTimersByTime(4000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[3].text);
    act(() => jest.advanceTimersByTime(4000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[0].text);
  });

  it("pauses while hovered", () => {
    renderHeader();
    fireEvent.mouseEnter(promo());
    act(() => jest.advanceTimersByTime(12000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[0].text);
    fireEvent.mouseLeave(promo());
    act(() => jest.advanceTimersByTime(4000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[1].text);
  });

  it("shows only the first message when reduced motion is preferred", () => {
    window.matchMedia = jest.fn().mockImplementation((query) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    renderHeader();
    act(() => jest.advanceTimersByTime(12000));
    expect(promo()).toHaveTextContent(PROMO_MESSAGES[0].text);
  });

  it("never advertises a discount", () => {
    PROMO_MESSAGES.forEach(({ text }) => expect(text).not.toMatch(/%|off\b|discount/i));
  });
});
