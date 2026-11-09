import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { supabase } from "lib/supabaseClient";
import CategoryRail from "../components/home/CategoryRail";

jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));
jest.mock("../components/home/ProductRail", () => {
  const Rail = (props) => (
    <div data-testid="rail" data-href={props.viewAllHref}>
      {props.title}
    </div>
  );
  return { __esModule: true, default: Rail, RAIL_PRODUCT_COLUMNS: "productid", RAIL_SIZE: 12 };
});


describe("CategoryRail", () => {
  it("queries every category in the collection and links View all to it", async () => {
    const inFn = jest.fn(() => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }));
    supabase.from.mockReturnValue({ select: () => ({ in: inFn }) });
    render(<CategoryRail slug="men" title="Men" />);
    await waitFor(() => expect(inFn).toHaveBeenCalled());
    expect(inFn).toHaveBeenCalledWith("categoryid", expect.arrayContaining(["SW", "KP"]));
    expect(screen.getByTestId("rail")).toHaveAttribute("data-href", "/collections/men");
  });

  it("caps the price when given maxPrice and opens the collection with the same filter", async () => {
    const lte = jest.fn(() => ({ order: () => ({ limit: () => Promise.resolve({ data: [] }) }) }));
    supabase.from.mockReturnValue({ select: () => ({ in: () => ({ lte }) }) });
    render(<CategoryRail slug="sarees" title="Sarees under ₹2,000" maxPrice={1999} />);
    await waitFor(() => expect(lte).toHaveBeenCalledWith("retailprice", 1999));
    expect(screen.getByTestId("rail")).toHaveAttribute("data-href", "/collections/sarees?max=1999");
  });
});
