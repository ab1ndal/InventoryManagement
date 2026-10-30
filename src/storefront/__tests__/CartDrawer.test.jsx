import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CartDrawer from "../components/cart/CartDrawer";
import { CartContext } from "../context/CartContext";

// The nudge queries Supabase for suggestions (FreeShippingNudge.test.jsx
// covers that); here we only check it receives the subtotal.
jest.mock("../components/FreeShippingNudge", () => ({ amount }) =>
  require("react").createElement("div", { "data-testid": "free-shipping-nudge", "data-amount": amount })
);


const ITEM_A = {
  variant_id: "v1",
  product_id: "p1",
  quantity: 2,
  name: "Silk Kurta",
  size: "M",
  color: "Red",
  price: 1500,
  image_url: null,
};

const ITEM_B = {
  variant_id: "v2",
  product_id: "p2",
  quantity: 1,
  name: "Cotton Dupatta",
  size: "Free",
  color: "Blue",
  price: 800,
  image_url: null,
};

function makeCtx(overrides = {}) {
  return {
    items: [],
    itemCount: 0,
    isOpen: true,
    openCart: jest.fn(),
    closeCart: jest.fn(),
    addItem: jest.fn(),
    removeItem: jest.fn(),
    updateQty: jest.fn(),
    clearCart: jest.fn(),
    revalidateCart: jest.fn(),
    renewHolds: jest.fn(),
    holdExpiresAt: null,
    holdStatus: {},
    ...overrides,
  };
}

function setupDrawer(overrides = {}) {
  const ctx = makeCtx(overrides);
  render(
    <MemoryRouter>
      <CartContext.Provider value={ctx}>
        <CartDrawer />
      </CartContext.Provider>
    </MemoryRouter>
  );
  return ctx;
}

describe("CartDrawer — empty state", () => {
  it("shows empty state message when no items", () => {
    setupDrawer();
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("shows Shop Now link when empty", () => {
    setupDrawer();
    expect(screen.getByRole("link", { name: /shop now/i })).toBeInTheDocument();
  });

  it("does not show Checkout link when empty", () => {
    setupDrawer();
    expect(screen.queryByRole("link", { name: /checkout/i })).not.toBeInTheDocument();
  });
});

describe("CartDrawer — with items", () => {
  it("renders item name", () => {
    setupDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByText("Silk Kurta")).toBeInTheDocument();
  });

  it("renders size · colour", () => {
    setupDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByText("M · Red")).toBeInTheDocument();
  });

  it("renders line total (price × qty)", () => {
    setupDrawer({ items: [ITEM_A], itemCount: 2 }); // 1500 × 2 = 3000
    // single item → line total equals subtotal; both render ₹3,000
    expect(screen.getAllByText("₹3,000")).toHaveLength(2);
  });

  it("renders subtotal across all items", () => {
    setupDrawer({ items: [ITEM_A, ITEM_B], itemCount: 3 }); // 3000 + 800 = 3800
    expect(screen.getByText("₹3,800")).toBeInTheDocument();
  });

  it("renders View cart link", () => {
    setupDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByRole("link", { name: /view cart/i })).toBeInTheDocument();
  });
});

describe("CartDrawer — interactions", () => {
  it("calls removeItem with variant_id when remove button clicked", () => {
    const cart = setupDrawer({ items: [ITEM_A], itemCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: /remove item/i }));
    expect(cart.removeItem).toHaveBeenCalledWith("v1");
  });

  it("calls updateQty(variant_id, qty-1) when decrease clicked", () => {
    const cart = setupDrawer({ items: [ITEM_A], itemCount: 2 }); // qty=2
    fireEvent.click(screen.getByRole("button", { name: /decrease quantity/i }));
    expect(cart.updateQty).toHaveBeenCalledWith("v1", 1);
  });

  it("decrease button is disabled when qty=1", () => {
    setupDrawer({ items: [{ ...ITEM_A, quantity: 1 }], itemCount: 1 });
    expect(screen.getByRole("button", { name: /decrease quantity/i })).toBeDisabled();
  });

  it("calls updateQty(variant_id, qty+1) when increase clicked", () => {
    const cart = setupDrawer({ items: [ITEM_A], itemCount: 2 }); // qty=2
    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(cart.updateQty).toHaveBeenCalledWith("v1", 3);
  });

  it("calls closeCart when close button clicked", () => {
    const cart = setupDrawer();
    fireEvent.click(screen.getByRole("button", { name: /close cart/i }));
    expect(cart.closeCart).toHaveBeenCalled();
  });

  it("calls closeCart when backdrop clicked", () => {
    const cart = setupDrawer();
    fireEvent.click(screen.getByTestId("cart-backdrop"));
    expect(cart.closeCart).toHaveBeenCalled();
  });
});

describe("CartDrawer — revalidate on open", () => {
  it("calls revalidateCart when drawer is open", () => {
    const cart = setupDrawer({ isOpen: true });
    expect(cart.revalidateCart).toHaveBeenCalled();
  });

  it("does not call revalidateCart when drawer is closed", () => {
    const cart = setupDrawer({ isOpen: false });
    expect(cart.revalidateCart).not.toHaveBeenCalled();
  });
});

describe("CartDrawer — stock holds", () => {
  it("renews holds on open and shows how long the cart is held", () => {
    const expires = new Date(Date.now() + 10 * 60000 + 30000).toISOString();
    const cart = setupDrawer({ items: [ITEM_A], itemCount: 2, holdExpiresAt: expires });
    expect(cart.renewHolds).toHaveBeenCalled();
    expect(screen.getByText(/held for you for/i)).toHaveTextContent(/10:(30|29)/);
  });

  it("keeps a line someone else holds and says why", () => {
    setupDrawer({
      items: [ITEM_A],
      itemCount: 2,
      holdStatus: { [ITEM_A.variant_id]: { held: 0, requested: ITEM_A.quantity, available: 0, reason: "unavailable" } },
    });
    expect(screen.getByText(ITEM_A.name)).toBeInTheDocument();
    expect(screen.getByText(/^In someone else's cart right now\. Kept in your cart/)).toBeInTheDocument();
  });

  it("does not renew holds while closed", () => {
    const cart = setupDrawer({ isOpen: false });
    expect(cart.renewHolds).not.toHaveBeenCalled();
  });
});

describe("CartDrawer — closed", () => {
  it("is inert when closed so its controls are not keyboard-reachable", () => {
    setupDrawer({ isOpen: false });
    expect(screen.getByRole("dialog", { hidden: true })).toHaveAttribute("inert");
  });

  it("is not inert when open", () => {
    setupDrawer({ isOpen: true });
    expect(screen.getByRole("dialog")).not.toHaveAttribute("inert");
  });
});

describe("CartDrawer — size label", () => {
  it("shows a customer-facing size instead of the raw code", () => {
    setupDrawer({ items: [{ ...ITEM_A, size: "XL|42" }], itemCount: 2 });
    expect(screen.getByText("XL (42) · Red")).toBeInTheDocument();
  });
});

describe("CartDrawer — free-shipping nudge", () => {
  it("passes the subtotal to the nudge while open", () => {
    setupDrawer({ items: [ITEM_A, ITEM_B], itemCount: 3 }); // 3000 + 800
    expect(screen.getByTestId("free-shipping-nudge")).toHaveAttribute("data-amount", "3800");
  });

  it("does not mount the nudge while closed", () => {
    setupDrawer({ items: [ITEM_A], itemCount: 2, isOpen: false });
    expect(screen.queryByTestId("free-shipping-nudge")).not.toBeInTheDocument();
  });
});
