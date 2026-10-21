import React from "react";
import { render, screen } from "@testing-library/react";
import ProductSpecs from "../components/product/ProductSpecs";
import { CARE_NOTE, COLOUR_NOTE } from "../lib/deliveryEstimate";

describe("ProductSpecs", () => {
  it("renders fabric and category rows when present", () => {
    render(<ProductSpecs fabric="Banarasi Silk" category="Sarees" />);
    expect(screen.getByText("Fabric")).toBeInTheDocument();
    expect(screen.getByText("Banarasi Silk")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Sarees")).toBeInTheDocument();
  });

  it("omits rows with no data but still shows the honest care + colour notes", () => {
    render(<ProductSpecs fabric={null} category={undefined} />);
    expect(screen.queryByText("Fabric")).not.toBeInTheDocument();
    expect(screen.queryByText("Category")).not.toBeInTheDocument();
    expect(screen.getByText(CARE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(COLOUR_NOTE)).toBeInTheDocument();
  });

  it("labels in-stock sizes as available sizes", () => {
    render(<ProductSpecs sizes={["M (38)", "L (40)"]} />);
    expect(screen.getByText("Available sizes")).toBeInTheDocument();
    expect(screen.getByText("M (38), L (40)")).toBeInTheDocument();
    expect(screen.queryByText("Sizes")).not.toBeInTheDocument();
  });

  it("uses the singular label for one available size", () => {
    render(<ProductSpecs sizes={["Unstitched"]} />);
    expect(screen.getByText("Available size")).toBeInTheDocument();
  });

  it("omits the row when no size is in stock", () => {
    render(<ProductSpecs sizes={[]} />);
    expect(screen.queryByText(/available size/i)).not.toBeInTheDocument();
  });
});
