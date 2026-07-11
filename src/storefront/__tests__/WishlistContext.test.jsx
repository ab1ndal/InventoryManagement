import React from "react";
import { render, screen, act } from "@testing-library/react";
import { WishlistProvider, useWishlist } from "../context/WishlistContext";

function Probe() {
  const { toggle, has, count } = useWishlist();
  return (
    <>
      <span data-testid="count">{count}</span>
      <span data-testid="has">{has("BC1") ? "yes" : "no"}</span>
      <button onClick={() => toggle({ productid: "BC1", name: "Saree", retailprice: 1000 })}>t</button>
    </>
  );
}
beforeEach(() => localStorage.clear());
it("toggles items and persists to localStorage", () => {
  render(<WishlistProvider><Probe /></WishlistProvider>);
  act(() => screen.getByText("t").click());
  expect(screen.getByTestId("count").textContent).toBe("1");
  expect(screen.getByTestId("has").textContent).toBe("yes");
  expect(JSON.parse(localStorage.getItem("bc_wishlist"))).toHaveLength(1);
  act(() => screen.getByText("t").click());
  expect(screen.getByTestId("count").textContent).toBe("0");
});
