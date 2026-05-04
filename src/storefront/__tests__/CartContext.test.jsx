import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { CartProvider, useCart } from "../context/CartContext";

const ITEM_V1 = {
  variant_id: "v1",
  product_id: "p1",
  quantity: 1,
  name: "Silk Kurta",
  size: "M",
  color: "Red",
  price: 1200,
  image_url: null,
};

const ITEM_V2 = {
  variant_id: "v2",
  product_id: "p1",
  quantity: 2,
  name: "Silk Kurta",
  size: "L",
  color: "Blue",
  price: 1200,
  image_url: null,
};

function Harness() {
  const { items, itemCount, addItem, removeItem, updateQty, clearCart } = useCart();
  return (
    <div>
      <output data-testid="count">{itemCount}</output>
      <output data-testid="items">{JSON.stringify(items)}</output>
      <button onClick={() => addItem(ITEM_V1)}>add-v1</button>
      <button onClick={() => addItem({ ...ITEM_V1, quantity: 3 })}>add-v1-qty3</button>
      <button onClick={() => addItem(ITEM_V2)}>add-v2</button>
      <button onClick={() => removeItem("v1")}>remove-v1</button>
      <button onClick={() => updateQty("v1", 5)}>update-v1-5</button>
      <button onClick={() => updateQty("v1", 0)}>update-v1-0</button>
      <button onClick={clearCart}>clear</button>
    </div>
  );
}

function renderHarness() {
  render(
    <CartProvider>
      <Harness />
    </CartProvider>
  );
}

beforeEach(() => localStorage.clear());

describe("CartContext — initial state", () => {
  it("starts with itemCount 0 and empty items", () => {
    renderHarness();
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(JSON.parse(screen.getByTestId("items").textContent)).toEqual([]);
  });

  it("reads items from localStorage on mount", () => {
    localStorage.setItem("bc_cart", JSON.stringify([ITEM_V1]));
    renderHarness();
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});

describe("CartContext — addItem", () => {
  it("adds a new item", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    expect(screen.getByTestId("count").textContent).toBe("1");
    const items = JSON.parse(screen.getByTestId("items").textContent);
    expect(items).toHaveLength(1);
    expect(items[0].variant_id).toBe("v1");
  });

  it("increments quantity when same variant_id added again", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));       // qty=1
    fireEvent.click(screen.getByRole("button", { name: "add-v1-qty3" })); // qty+=3
    expect(screen.getByTestId("count").textContent).toBe("4");
    const items = JSON.parse(screen.getByTestId("items").textContent);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(4);
  });

  it("adds a separate item for a different variant_id", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));
    const items = JSON.parse(screen.getByTestId("items").textContent);
    expect(items).toHaveLength(2);
  });
});

describe("CartContext — removeItem", () => {
  it("removes the item with matching variant_id", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-v1" }));
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(JSON.parse(screen.getByTestId("items").textContent)).toEqual([]);
  });
});

describe("CartContext — updateQty", () => {
  it("updates quantity for matching variant_id", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "update-v1-5" }));
    expect(screen.getByTestId("count").textContent).toBe("5");
    const items = JSON.parse(screen.getByTestId("items").textContent);
    expect(items[0].quantity).toBe(5);
  });

  it("removes item when quantity updated to 0", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "update-v1-0" }));
    expect(JSON.parse(screen.getByTestId("items").textContent)).toHaveLength(0);
  });
});

describe("CartContext — clearCart", () => {
  it("empties all items", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(JSON.parse(screen.getByTestId("items").textContent)).toEqual([]);
  });
});

describe("CartContext — itemCount", () => {
  it("sums quantity across all items", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));  // qty=1
    fireEvent.click(screen.getByRole("button", { name: "add-v2" }));  // qty=2
    expect(screen.getByTestId("count").textContent).toBe("3");
  });
});

describe("CartContext — localStorage persistence", () => {
  it("persists items to localStorage after addItem", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    const stored = JSON.parse(localStorage.getItem("bc_cart"));
    expect(stored).toHaveLength(1);
    expect(stored[0].variant_id).toBe("v1");
  });

  it("clears localStorage after clearCart", () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    const stored = JSON.parse(localStorage.getItem("bc_cart"));
    expect(stored).toEqual([]);
  });
});
