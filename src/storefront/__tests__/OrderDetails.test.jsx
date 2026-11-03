import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import OrderDetails from "../components/OrderDetails";

jest.mock("lib/supabaseClient", () => ({ supabase: {} }));

const MOCKUP = "https://abc.supabase.co/storage/v1/object/public/mockups/kurti/front.webp";

function order(item) {
  return {
    items: [{ name: "Silk Saree", size: "M", color: "Red", qty: 1, status: "ordered", ...item }],
    totals: { subtotal: 1000, promoDiscount: 0, shipping: 0, voucherApplied: 0, creditApplied: 0, gatewayAmount: 1000 },
  };
}

it("shows the item's 150px variant, lazily, named for the product", () => {
  render(<OrderDetails order={order({ imageUrl: MOCKUP })} />);
  const img = screen.getByRole("img", { name: "Silk Saree" });
  expect(img).toHaveAttribute("src", MOCKUP.replace(".webp", "_150.webp"));
  expect(img).toHaveAttribute("loading", "lazy");
});

it.each([[null], [undefined]])("renders the row without a placeholder when the photo is %s", (imageUrl) => {
  render(<OrderDetails order={order({ imageUrl })} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/Silk Saree/)).toBeInTheDocument();
});

it("drops a photo that fails to load", () => {
  render(<OrderDetails order={order({ imageUrl: MOCKUP })} />);
  fireEvent.error(screen.getByRole("img", { name: "Silk Saree" }));
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/Silk Saree/)).toBeInTheDocument();
});
