import React from "react";
import { render, screen, within } from "@testing-library/react";
import OrderTimeline from "../components/OrderTimeline";

function completed() {
  return within(screen.getByRole("list", { name: /order progress/i }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-complete") === "true");
}

it("ticks steps up to the current status", () => {
  render(<OrderTimeline status="shipped" />);
  expect(completed()).toEqual([true, true, true, false, false]);
});

it("shows staff-side processing as paid", () => {
  render(<OrderTimeline status="processing" />);
  expect(completed()).toEqual([true, false, false, false, false]);
});

it("notes a cancelled order", () => {
  render(<OrderTimeline status="cancelled" />);
  expect(screen.getByText(/This order was cancelled/)).toBeInTheDocument();
});

it("notes a parcel returning to origin, without refunding shipping", () => {
  const { rerender } = render(<OrderTimeline status="rto" />);
  expect(screen.getByText(/returning this parcel to us/)).toBeInTheDocument();
  rerender(<OrderTimeline status="rto_received" />);
  expect(screen.getByText(/shipping is not refundable/)).toBeInTheDocument();
});

it("renders nothing for an unpaid order", () => {
  const { container } = render(<OrderTimeline status="pending_payment" />);
  expect(container).toBeEmptyDOMElement();
});
