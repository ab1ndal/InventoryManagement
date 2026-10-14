import React from "react";
import { render, screen } from "@testing-library/react";
import SizeGuidePage from "../pages/SizeGuidePage";

describe("SizeGuidePage", () => {
  it("renders the heading and a measurement table with size columns", () => {
    render(<SizeGuidePage />);
    expect(screen.getByRole("heading", { name: /size guide/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /fits bust/i })).toBeInTheDocument();
  });

  it("uses the store's sizing: XL fits a 42-inch bust, up to 6XL", () => {
    render(<SizeGuidePage />);
    expect(screen.getByRole("row", { name: "XL 42" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: "6XL 52" })).toBeInTheDocument();
    expect(screen.queryByText(/waist/i)).not.toBeInTheDocument();
  });
});
