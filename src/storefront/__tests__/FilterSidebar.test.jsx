import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import FilterSidebar from "../components/shop/FilterSidebar";

const EMPTY = {
  categories: [],
  colors: [],
  sizes: [],
  fabrics: [],
  priceMin: null,
  priceMax: null,
};

function setup(overrides = {}) {
  const props = {
    filters: EMPTY,
    categoryOptions: [
      { categoryid: 1, name: "Sarees" },
      { categoryid: 2, name: "Lehengas" },
    ],
    colorOptions: ["Blue", "Green", "Red"],
    colorFamilyHex: { Blue: "#0000ff", Green: "#00ff00", Red: null },
    sizeOptions: ["S|36", "M|38"],
    sizeDisplayMap: { "S|36": "S / 36", "M|38": "M / 38" },
    fabricOptions: ["Silk", "Cotton"],
    availableOptions: null,
    baseOptions: null,
    toggle: jest.fn(),
    setPrice: jest.fn(),
    clearField: jest.fn(),
    clearOne: jest.fn(),
    ...overrides,
  };
  render(<FilterSidebar {...props} />);
  return props;
}

const section = (name) => screen.getByRole("group", { name });

describe("FilterSidebar", () => {
  it("renders sections in order Category, Price, Size, Colour, Fabric", () => {
    setup();
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
      "Category",
      "Price",
      "Size",
      "Colour",
      "Fabric",
    ]);
  });

  it("toggles an option instantly via the hook", () => {
    const props = setup();
    fireEvent.click(within(section("Colour")).getByRole("checkbox", { name: "Blue" }));
    expect(props.toggle).toHaveBeenCalledWith("colors", "Blue");
    fireEvent.click(within(section("Size")).getByRole("checkbox", { name: "M / 38" }));
    expect(props.toggle).toHaveBeenCalledWith("sizes", "M|38");
    fireEvent.click(within(section("Category")).getByRole("checkbox", { name: "Lehengas" }));
    expect(props.toggle).toHaveBeenCalledWith("categories", 2);
  });

  it("hides options missing from baseOptions", () => {
    setup({
      baseOptions: {
        categories: new Set([1, 2]),
        colors: new Set(["Blue", "Red"]),
        sizes: new Set(["S|36"]),
        fabrics: new Set(["Silk", "Cotton"]),
      },
    });
    expect(within(section("Colour")).queryByRole("checkbox", { name: "Green" })).toBeNull();
    expect(within(section("Size")).queryByRole("checkbox", { name: "M / 38" })).toBeNull();
  });

  it("greys and disables options missing from availableOptions unless selected", () => {
    const props = setup({
      filters: { ...EMPTY, colors: ["Green"] },
      availableOptions: {
        categories: new Set([1, 2]),
        colors: new Set(["Blue"]),
        sizes: new Set(["S|36", "M|38"]),
        fabrics: new Set(["Silk", "Cotton"]),
      },
    });
    const colour = section("Colour");
    const red = within(colour).getByRole("checkbox", { name: "Red" });
    expect(red).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(red);
    expect(props.toggle).not.toHaveBeenCalled();

    const green = within(colour).getByRole("checkbox", { name: "Green" });
    expect(green).toHaveAttribute("aria-checked", "true");
    expect(green).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(green);
    expect(props.toggle).toHaveBeenCalledWith("colors", "Green");
  });

  it("shows a section Clear link only when that section has a selection", () => {
    const props = setup({ filters: { ...EMPTY, fabrics: ["Silk"] } });
    expect(within(section("Colour")).queryByRole("button", { name: /clear/i })).toBeNull();
    fireEvent.click(within(section("Fabric")).getByRole("button", { name: "Clear Fabric" }));
    expect(props.clearField).toHaveBeenCalledWith("fabrics");
  });

  it("collapses lists longer than 8 behind View more", () => {
    const colorOptions = Array.from({ length: 11 }, (_, i) => `C${i}`);
    setup({ colorOptions, colorFamilyHex: {} });
    const colour = section("Colour");
    expect(within(colour).getAllByRole("checkbox")).toHaveLength(8);
    fireEvent.click(within(colour).getByRole("button", { name: /view more/i }));
    expect(within(colour).getAllByRole("checkbox")).toHaveLength(11);
    expect(within(colour).getByRole("button", { name: /view less/i })).toBeInTheDocument();
  });

  it("applies a price preset", () => {
    const props = setup();
    fireEvent.click(within(section("Price")).getByRole("button", { name: "₹2,000 – ₹5,000" }));
    expect(props.setPrice).toHaveBeenCalledWith(2000, 4999);
  });

  it("clears the price when the active preset is clicked again", () => {
    const props = setup({ filters: { ...EMPTY, priceMin: 2000, priceMax: 4999 } });
    const preset = within(section("Price")).getByRole("button", { name: "₹2,000 – ₹5,000" });
    expect(preset).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(preset);
    expect(props.clearOne).toHaveBeenCalledWith("price", "price");
  });
});
