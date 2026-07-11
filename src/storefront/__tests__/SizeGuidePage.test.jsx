import React from "react";
import { render, screen } from "@testing-library/react";
import SizeGuidePage from "../pages/SizeGuidePage";

describe("SizeGuidePage", () => {
  it("renders the heading and a measurement table with size columns", () => {
    render(<SizeGuidePage />);
    expect(screen.getByRole("heading", { name: /size guide/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "M" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Bust" })).toBeInTheDocument();
  });
});
