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
    expect(screen.getByRole("button", { name: "L" })).toBeInTheDocument();
  });

  it("disables a size when all its colours have stock=0", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "L" })).toBeDisabled();
  });

  it("does not disable a size that has at least one colour in stock", () => {
    render(<VariantPicker variants={VARIANTS} onVariantSelect={jest.fn()} />);
    expect(screen.getByRole("button", { name: "S" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "M" })).not.toBeDisabled();
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
  it("calls onVariantSelect(null) when a size is selected", () => {
    const onSelect = jest.fn();
    render(<VariantPicker variants={VARIANTS} onVariantSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
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
