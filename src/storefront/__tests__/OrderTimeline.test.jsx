import React from "react";
import { render, screen, within } from "@testing-library/react";
import OrderTimeline from "../components/OrderTimeline";

function completed() {
  return within(screen.getByRole("list", { name: /order progress/i }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-complete") === "true");
}

const SIX = ["Order placed", "Processed", "Packed", "Picked up", "Out for delivery", "Delivered"];

function stepNames() {
  return within(screen.getByRole("list", { name: /order progress/i }))
    .getAllByRole("listitem")
    .map((li) => li.textContent.replace(/^(✓|\d)/, "").replace(/\s*\((done|pending)\)/, ""));
}

it.each([
  ["paid", 1],
  ["cancelling", 1],
  ["cancelled", 1],
  ["processing", 2],
  ["processed", 2],
  ["packed", 3],
  ["shipped", 4],
  ["out_for_delivery", 5],
  ["delivered", 6],
])("a ship order at %s ticks the first %i of six steps", (status, ticked) => {
  render(<OrderTimeline status={status} />);
  expect(stepNames()).toEqual(SIX);
  expect(completed()).toEqual(SIX.map((_, i) => i < ticked));
});

it("lays the steps in three columns from sm, one column on a phone", () => {
  render(<OrderTimeline status="packed" />);
  expect(screen.getByRole("list", { name: /order progress/i })).toHaveClass("grid-cols-1", "sm:grid-cols-3");
});

it("notes a cancelled order", () => {
  render(<OrderTimeline status="cancelled" />);
  expect(screen.getByText(/This order was cancelled/)).toBeInTheDocument();
});

it("notes a parcel returning to origin, without refunding shipping", () => {
  const stopsAtPickedUp = [true, true, true, true, false, false];
  const { rerender } = render(<OrderTimeline status="rto" />);
  expect(screen.getByText(/returning this parcel to us/)).toBeInTheDocument();
  expect(completed()).toEqual(stopsAtPickedUp);
  rerender(<OrderTimeline status="rto_received" />);
  expect(screen.getByText(/shipping is not refundable/)).toBeInTheDocument();
  expect(completed()).toEqual(stopsAtPickedUp);
});

it("renders nothing for an unpaid order", () => {
  const { container } = render(<OrderTimeline status="pending_payment" />);
  expect(container).toBeEmptyDOMElement();
});

describe("store pickup", () => {
  it("shows Paid → Ready for pickup → Collected", () => {
    render(<OrderTimeline status="paid" fulfilment="pickup" />);
    expect(stepNames()).toEqual(["Paid", "Ready for pickup", "Collected"]);
    expect(completed()).toEqual([true, false, false]);
  });

  it("shows the shop address once the order is ready", () => {
    render(<OrderTimeline status="ready_for_pickup" fulfilment="pickup" />);
    expect(completed()).toEqual([true, true, false]);
    expect(screen.getByText(/58 Sihani Gate Market, Near Durga Bhabhi Chowk, Ghaziabad, UP 201001/)).toBeInTheDocument();
    expect(screen.getByText(/Bring your order number/)).toBeInTheDocument();
  });

  it("ticks every step once collected", () => {
    render(<OrderTimeline status="delivered" fulfilment="pickup" />);
    expect(completed()).toEqual([true, true, true]);
    expect(screen.queryByText(/Bring your order number/)).not.toBeInTheDocument();
  });

  it("notes a cancelled pickup order", () => {
    render(<OrderTimeline status="cancelled" fulfilment="pickup" />);
    expect(completed()).toEqual([true, false, false]);
    expect(screen.getByText(/This order was cancelled/)).toBeInTheDocument();
  });
});
