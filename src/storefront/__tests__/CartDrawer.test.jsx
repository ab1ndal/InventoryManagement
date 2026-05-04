import React from "react";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CartDrawer from "../components/cart/CartDrawer";
import { CartContext } from "../context/CartContext";

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
    ...overrides,
  };
}

function renderDrawer(overrides = {}) {
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
    renderDrawer();
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument();
  });

  it("shows Shop Now link when empty", () => {
    renderDrawer();
    expect(screen.getByRole("link", { name: /shop now/i })).toBeInTheDocument();
  });

  it("does not show Checkout link when empty", () => {
    renderDrawer();
    expect(screen.queryByRole("link", { name: /checkout/i })).not.toBeInTheDocument();
  });
});

describe("CartDrawer — with items", () => {
  it("renders item name", () => {
    renderDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByText("Silk Kurta")).toBeInTheDocument();
  });

  it("renders size · colour", () => {
    renderDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByText("M · Red")).toBeInTheDocument();
  });

  it("renders line total (price × qty)", () => {
    renderDrawer({ items: [ITEM_A], itemCount: 2 }); // 1500 × 2 = 3000
    // single item → line total equals subtotal; both render ₹3,000
    expect(screen.getAllByText("₹3,000")).toHaveLength(2);
  });

  it("renders subtotal across all items", () => {
    renderDrawer({ items: [ITEM_A, ITEM_B], itemCount: 3 }); // 3000 + 800 = 3800
    expect(screen.getByText("₹3,800")).toBeInTheDocument();
  });

  it("renders Checkout link", () => {
    renderDrawer({ items: [ITEM_A], itemCount: 2 });
    expect(screen.getByRole("link", { name: /checkout/i })).toBeInTheDocument();
  });
});

describe("CartDrawer — interactions", () => {
  it("calls removeItem with variant_id when remove button clicked", () => {
    const ctx = renderDrawer({ items: [ITEM_A], itemCount: 2 });
    fireEvent.click(screen.getByRole("button", { name: /remove item/i }));
    expect(ctx.removeItem).toHaveBeenCalledWith("v1");
  });

  it("calls updateQty(variant_id, qty-1) when decrease clicked", () => {
    const ctx = renderDrawer({ items: [ITEM_A], itemCount: 2 }); // qty=2
    fireEvent.click(screen.getByRole("button", { name: /decrease quantity/i }));
    expect(ctx.updateQty).toHaveBeenCalledWith("v1", 1);
  });

  it("decrease button is disabled when qty=1", () => {
    renderDrawer({ items: [{ ...ITEM_A, quantity: 1 }], itemCount: 1 });
    expect(screen.getByRole("button", { name: /decrease quantity/i })).toBeDisabled();
  });

  it("calls updateQty(variant_id, qty+1) when increase clicked", () => {
    const ctx = renderDrawer({ items: [ITEM_A], itemCount: 2 }); // qty=2
    fireEvent.click(screen.getByRole("button", { name: /increase quantity/i }));
    expect(ctx.updateQty).toHaveBeenCalledWith("v1", 3);
  });

  it("calls closeCart when close button clicked", () => {
    const ctx = renderDrawer();
    fireEvent.click(screen.getByRole("button", { name: /close cart/i }));
    expect(ctx.closeCart).toHaveBeenCalled();
  });

  it("calls closeCart when backdrop clicked", () => {
    const ctx = renderDrawer();
    fireEvent.click(screen.getByTestId("cart-backdrop"));
    expect(ctx.closeCart).toHaveBeenCalled();
  });
});
