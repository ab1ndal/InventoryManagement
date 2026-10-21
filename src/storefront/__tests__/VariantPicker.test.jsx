import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import VariantPicker from "../components/product/VariantPicker";

const VARIANTS = [
  { variantid: "v1", size: "S", color: "Red", stock: 2 },
  { variantid: "v2", size: "S", color: "Blue", stock: 0 },
  { variantid: "v3", size: "M", color: "Red", stock: 1 },
  { variantid: "v4", size: "M", color: "Blue", stock: 3 },
  { variantid: "v5", size: "L", color: "Red", stock: 0 },
];

// L has only stock=0 — all colours unavailable, so size L is unavailable overall.

describe("VariantPicker — sizes", () => {
  it("renders all unique sizes", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "S" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "L, out of stock" })).toBeInTheDocument();
  });

  it("disables a size when all its colours have stock=0", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "L, out of stock" })).toBeDisabled();
  });

  it("does not disable a size that has at least one colour in stock", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "S" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "M" })).not.toBeDisabled();
  });
});

describe("VariantPicker — standard letter sizes", () => {
  const LETTER = [
    { variantid: "a", size: "L|40", color: "Red", stock: 1 },
    { variantid: "b", size: "XL|42", color: "Red", stock: 2 },
    { variantid: "c", size: "4XL|48", color: "Red", stock: 0 },
  ];

  function sizeButtons() {
    return screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? b.textContent);
  }

  it("always lists XS to 2XL plus extra sizes in order", () => {
    render(<VariantPicker variants={LETTER} onVariantSelect={jest.fn()} />);
    expect(sizeButtons()).toEqual([
      "XS (34), out of stock",
      "S (36), out of stock",
      "M (38), out of stock",
      "L (40)",
      "XL (42)",
      "2XL (44), out of stock",
      "4XL (48), out of stock",
    ]);
  });

  it("shows sizes the product lacks as out of stock and not selectable", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={LETTER} onVariantSelect={onSelect} />);
    const xs = screen.getByRole("button", { name: "XS (34), out of stock" });
    expect(xs).toBeDisabled();
    fireEvent.click(xs);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Colour/)).not.toBeInTheDocument();
  });

  it("auto-selects only a truly available size, ignoring padded ones", () => {
    const onSelect = jest.fn();
    const one = [{ variantid: "z", size: "M|38", color: "Blue", stock: 1 }];
    render(<VariantPicker variants={one} onVariantSelect={onSelect} />);
    expect(onSelect).toHaveBeenLastCalledWith(one[0]);
    expect(screen.getAllByRole("button", { name: /out of stock/ })).toHaveLength(5);
  });

  it("leaves products without letter sizes unchanged", () => {
    const special = [
      { variantid: "f", size: "FREE-SIZE", color: "Red", stock: 1 },
      { variantid: "g", size: "UNSTITCHED", color: "Red", stock: 1 },
    ];
    render(<VariantPicker variants={special} onVariantSelect={jest.fn()} />);
    expect(sizeButtons()).toEqual(["Free Size", "Unstitched"]);
  });
});

describe("VariantPicker — colour reveal", () => {
  it("does not show colours before a size is selected", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.queryByText("Red")).not.toBeInTheDocument();
    expect(screen.queryByText("Blue")).not.toBeInTheDocument();
  });

  it("shows colours for selected size after clicking a size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Red" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blue" })).toBeInTheDocument();
  });

  it("disables a colour when its stock=0 for the selected size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Blue" })).toBeDisabled();
  });

  it("enables a colour when its stock>0 for the selected size", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByRole("button", { name: "Red" })).not.toBeDisabled();
  });

  it("resets colours shown when size changes", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    // M has Red and Blue — different set from S (S also has Red+Blue but both available for M)
    expect(screen.getByRole("button", { name: "Red" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Blue" })).not.toBeDisabled();
  });
});

describe("VariantPicker — onVariantSelect callback", () => {
  it("calls onVariantSelect(null) when a size with several colours is selected", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("calls onVariantSelect with matching variant when colour selected after size", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    expect(onSelect).toHaveBeenLastCalledWith(VARIANTS[0]); // { variantid: "v1", size: "S", color: "Red", stock: 2 }
  });

  it("calls onVariantSelect(null) when size changes after a colour was selected", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "Red" }));
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("does not call onVariantSelect when a disabled colour is clicked", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    onSelect.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Blue" })); // stock=0, disabled
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("VariantPicker — single option auto-select", () => {
  it("selects the only available size and colour so Add to Cart is ready", () => {
    const onSelect = jest.fn();
    const only = [{ variantid: "u1", size: "UNSTITCHED", color: "Green", stock: 1 }];
    render(<VariantPicker variants={only} onVariantSelect={onSelect} />);
    expect(onSelect).toHaveBeenLastCalledWith(only[0]);
  });

  it("selects the only in-stock colour after a size is chosen", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(onSelect).toHaveBeenLastCalledWith(VARIANTS[0]);
  });

  it("does not pre-select when several sizes are available", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalledWith(expect.objectContaining({ variantid: expect.any(String) }));
  });
});
