import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { CartProvider, useCart } from "../context/CartContext";
import {
  fetchServerCart, removeServerItem, clearServerCart, fetchLiveVariantData,
} from "../lib/cartApi";

const mockUpsert = jest.fn(async () => {});
jest.mock("../lib/cartApi", () => ({
  fetchServerCart: jest.fn(async () => []),
  upsertItem: (...a) => mockUpsert(...a),
  removeServerItem: jest.fn(async () => {}),
  clearServerCart: jest.fn(async () => {}),
  fetchLiveVariantData: jest.fn(async () => ({})),
}));
let authCb;
const mockInvoke = jest.fn();
jest.mock("lib/supabaseClient", () => ({
  supabase: {
    functions: { invoke: (...a) => mockInvoke(...a) },
    auth: {
      onAuthStateChange: (cb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));
jest.mock("sonner", () => ({ toast: { warning: jest.fn() } }));

// jsdom has no Web Crypto; the guest holder key needs getRandomValues.
beforeAll(() => {
  Object.defineProperty(window, "crypto", { value: require("crypto").webcrypto, configurable: true });
});

const NO_HOLDS = { rateLimited: false, items: [], expiresAt: null };

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
  const { items, itemCount, holdExpiresAt, holdStatus, addItem, removeItem, updateQty, clearCart, renewHolds } = useCart();
  return (
    <div>
      <output data-testid="count">{itemCount}</output>
      <output data-testid="expires">{holdExpiresAt ?? ""}</output>
      <output data-testid="items">{JSON.stringify(items)}</output>
      <output data-testid="hold-status">{JSON.stringify(holdStatus)}</output>
      <button onClick={() => addItem(ITEM_V1)}>add-v1</button>
      <button onClick={() => addItem({ ...ITEM_V1, quantity: 3 })}>add-v1-qty3</button>
      <button onClick={() => addItem(ITEM_V2)}>add-v2</button>
      <button onClick={() => addItem({ ...ITEM_V1, stock: 1 })}>add-v1-last-piece</button>
      <button onClick={() => removeItem("v1")}>remove-v1</button>
      <button onClick={() => updateQty("v1", 5)}>update-v1-5</button>
      <button onClick={() => updateQty("v1", 0)}>update-v1-0</button>
      <button onClick={clearCart}>clear</button>
      <button onClick={renewHolds}>renew</button>
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

beforeEach(() => {
  localStorage.clear();
  mockInvoke.mockResolvedValue({ data: NO_HOLDS, error: null });
});

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

  it("never holds more than the known stock, even on rapid repeat clicks", () => {
    renderHarness();
    const add = screen.getByRole("button", { name: "add-v1-last-piece" });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "update-v1-5" }));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
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

describe("CartContext — auth-aware write-through", () => {
  function Probe() {
    const { addItem, itemCount } = useCart();
    return (
      <>
        <span data-testid="count">{itemCount}</span>
        <button onClick={() => addItem({ variant_id: "v1", product_id: "BC1", quantity: 1, name: "X", size: "F", color: "R", price: 10, image_url: null })}>add</button>
      </>
    );
  }

  beforeEach(() => {
    localStorage.clear();
    mockUpsert.mockImplementation(async () => {});
    fetchServerCart.mockResolvedValue([]);
    removeServerItem.mockResolvedValue();
    clearServerCart.mockResolvedValue();
    fetchLiveVariantData.mockResolvedValue({});
  });

  it("writes through to the server when a user is signed in", async () => {
    render(<CartProvider><Probe /></CartProvider>);
    await act(async () => { authCb("SIGNED_IN", { user: { id: "u1" } }); });
    await act(async () => { screen.getByText("add").click(); });
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(mockUpsert).toHaveBeenCalledWith({ variant_id: "v1", product_id: "BC1", quantity: 1 });
  });

  it("does not write through as a guest", async () => {
    render(<CartProvider><Probe /></CartProvider>);
    await act(async () => { screen.getByText("add").click(); });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("CartContext — guest cart survives INITIAL_SESSION with no session", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpsert.mockImplementation(async () => {});
    fetchServerCart.mockResolvedValue([]);
    removeServerItem.mockResolvedValue();
    clearServerCart.mockResolvedValue();
    fetchLiveVariantData.mockResolvedValue({});
  });

  it("does not wipe the guest cart when INITIAL_SESSION fires with a null session", async () => {
    localStorage.setItem("bc_cart", JSON.stringify([ITEM_V1]));
    renderHarness();
    expect(screen.getByTestId("count").textContent).toBe("1");
    await act(async () => { authCb("INITIAL_SESSION", null); });
    expect(screen.getByTestId("count").textContent).toBe("1");
    const items = JSON.parse(screen.getByTestId("items").textContent);
    expect(items).toHaveLength(1);
    expect(items[0].variant_id).toBe("v1");
  });

  it("clears the cart on a genuine SIGNED_OUT event", async () => {
    localStorage.setItem("bc_cart", JSON.stringify([ITEM_V1]));
    renderHarness();
    expect(screen.getByTestId("count").textContent).toBe("1");
    await act(async () => { authCb("SIGNED_OUT", null); });
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(JSON.parse(screen.getByTestId("items").textContent)).toEqual([]);
  });
});

describe("CartContext — auth callback must not block the auth lock", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchServerCart.mockReset();
  });

  // supabase-js awaits onAuthStateChange callbacks while holding its auth lock
  // (e.g. SIGNED_IN during initialize()). A callback that awaits a Supabase
  // query deadlocks: the query's getSession() waits for that same lock.
  it("returns synchronously even when the server cart never resolves", async () => {
    fetchServerCart.mockReturnValue(new Promise(() => {}));
    renderHarness();
    let ret;
    await act(async () => { ret = authCb("SIGNED_IN", { user: { id: "u1" } }); });
    expect(ret).toBeUndefined();
  });

  it("still loads the server cart after the callback returns", async () => {
    fetchServerCart.mockResolvedValue([ITEM_V2]);
    renderHarness();
    await act(async () => { authCb("INITIAL_SESSION", { user: { id: "u1" } }); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(fetchServerCart).toHaveBeenCalled();
    expect(screen.getByTestId("count").textContent).toBe("2");
  });
});

describe("CartContext — pending sync on unmount", () => {
  it("cancels a deferred sign-in sync when the provider unmounts", async () => {
    fetchServerCart.mockReset();
    fetchServerCart.mockResolvedValue([]);
    const { unmount } = render(<CartProvider><Harness /></CartProvider>);
    act(() => { authCb("SIGNED_IN", { user: { id: "u1" } }); });
    unmount();
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchServerCart).not.toHaveBeenCalled();
  });
});

describe("CartContext — stock holds", () => {
  const holdResponse = (items, expiresAt = "2026-10-30T10:15:00.000Z") => ({
    data: { rateLimited: false, items, expiresAt },
    error: null,
  });
  const lastHoldBody = () => mockInvoke.mock.calls[mockInvoke.mock.calls.length - 1][1].body;

  it("holds the new line quantity under the guest key", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1-qty3" }));
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledWith("cart-hold", {
      body: { holderKey: localStorage.getItem("bc_holder"), items: [{ variantId: "v1", qty: 3 }] },
    });
    expect(localStorage.getItem("bc_holder")).toMatch(/^g:/);
  });

  it("keeps the line when someone else holds the rest, and says so", async () => {
    mockInvoke.mockResolvedValue(
      holdResponse([{ variantId: "v1", requested: 3, held: 1, available: 1, reason: "unavailable" }])
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1-qty3" }));
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        "Only 1 available right now — kept in your cart",
        expect.objectContaining({ description: "Silk Kurta" })
      )
    );
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(JSON.parse(screen.getByTestId("hold-status").textContent)).toEqual({
      v1: { held: 1, requested: 3, available: 1, reason: "unavailable" },
    });
  });

  it("does not toast on a re-check, only on a fresh add", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1-qty3" }));
    await act(async () => {});
    mockInvoke.mockResolvedValue(
      holdResponse([{ variantId: "v1", requested: 3, held: 0, available: 3, reason: "cooldown" }], null)
    );
    fireEvent.click(screen.getByRole("button", { name: "renew" }));
    await waitFor(() => expect(screen.getByTestId("hold-status")).toHaveTextContent("cooldown"));
    expect(toast.warning).not.toHaveBeenCalled();
    expect(screen.getByTestId("count")).toHaveTextContent("3");
  });

  it("keeps the line when only an anti-hoarding cap stopped the hold", async () => {
    mockInvoke.mockResolvedValue(
      holdResponse([{ variantId: "v1", requested: 3, held: 0, available: 3, reason: "holder_cap" }])
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1-qty3" }));
    await act(async () => {});
    expect(screen.getByTestId("count")).toHaveTextContent("3");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("keeps the cart as is when the hold call fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockRejectedValue(new Error("Failed to fetch"));
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    await act(async () => {});
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    expect(warn).toHaveBeenCalledWith("cart-hold failed; cart kept as is", expect.anything());
    warn.mockRestore();
  });

  it("releases the hold when a line is removed", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "remove-v1" }));
    await act(async () => {});
    expect(lastHoldBody().items).toEqual([{ variantId: "v1", qty: 0 }]);
  });

  it("releases every hold when the cart is cleared", async () => {
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    fireEvent.click(screen.getByRole("button", { name: "clear" }));
    await act(async () => {});
    expect(lastHoldBody()).toEqual({ holderKey: expect.stringMatching(/^g:/), items: [], replace: true });
  });

  it("exposes the hold expiry from the latest response", async () => {
    mockInvoke.mockResolvedValue(
      holdResponse([{ variantId: "v1", requested: 1, held: 1, available: 1, reason: null }])
    );
    renderHarness();
    fireEvent.click(screen.getByRole("button", { name: "add-v1" }));
    await waitFor(() => expect(screen.getByTestId("expires")).toHaveTextContent("2026-10-30T10:15:00.000Z"));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });
});
