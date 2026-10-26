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
    // The size table goes by bust only; waist appears only in the how-to-measure list.
    expect(screen.queryByRole("columnheader", { name: /waist/i })).not.toBeInTheDocument();
  });

  it("shows the how-to-measure diagram with the tailor's measurements, not a placeholder", () => {
    render(<SizeGuidePage />);
    expect(screen.getByRole("img", { name: /where to measure/i })).toBeInTheDocument();
    ["Bust / Chest", "Waist", "Hip", "Shoulder", "Sleeve length", "Armhole", "Length"].forEach((name) =>
      expect(screen.getByText(`${name}:`)).toBeInTheDocument()
    );
    expect(document.body.textContent).not.toMatch(/\[measurement diagram\]/i);
  });
});
