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

it("joins the steps with a line that is dark up to the current step", () => {
  render(<OrderTimeline status="packed" />);
  const lines = screen.getAllByTestId("timeline-connector");
  expect(lines).toHaveLength(5);
  expect(lines.map((l) => l.classList.contains("bg-storefront-charcoal"))).toEqual([true, true, false, false, false]);
});

it("runs top to bottom on a phone and left to right from md", () => {
  render(<OrderTimeline status="packed" />);
  expect(screen.getByRole("list", { name: /order progress/i })).toHaveClass("md:flex");
});

it.each([
  ["paid", /checking your items/],
  ["processed", /confirmed and being prepared/],
  ["packed", /waiting to be picked up/],
  ["shipped", /on its way to you/],
  ["out_for_delivery", /out for delivery and should reach you soon/],
  ["delivered", /return within 7 days/],
])("says in a sentence what is happening at %s", (status, text) => {
  render(<OrderTimeline status={status} />);
  expect(screen.getByText(text)).toBeInTheDocument();
});

it("leaves the explaining to the existing note when an order has stopped or is ready to collect", () => {
  const { rerender } = render(<OrderTimeline status="cancelled" />);
  expect(screen.queryByText(/checking your items/)).not.toBeInTheDocument();
  rerender(<OrderTimeline status="ready_for_pickup" fulfilment="pickup" />);
  expect(screen.getByText(/Your order is ready at our shop/)).toBeInTheDocument();
});

it("marks the current step, but none on an order that has stopped", () => {
  const { container, rerender } = render(<OrderTimeline status="packed" />);
  expect(container.querySelector('[aria-current="step"]')).toHaveTextContent("Packed");
  rerender(<OrderTimeline status="cancelled" />);
  expect(container.querySelector('[aria-current="step"]')).toBeNull();
  rerender(<OrderTimeline status="rto" />);
  expect(container.querySelector('[aria-current="step"]')).toBeNull();
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

describe("step times", () => {
  const row = (name) =>
    within(screen.getByRole("list", { name: /order progress/i }))
      .getAllByRole("listitem")
      .find((li) => li.textContent.includes(name));
  const TIMES = {
    paid: "2026-11-01T17:03:00Z",
    processed: "2026-11-02T04:00:00Z",
    packed: "2026-11-02T06:00:00Z",
    shipped: "2026-11-03T06:00:00Z",
  };

  it("shows India time under each completed step", () => {
    render(<OrderTimeline status="packed" statusTimes={TIMES} />);
    expect(row("Order placed").querySelector("time")).toHaveTextContent("1 Nov, 10:33 pm");
    expect(row("Order placed").querySelector("time")).toHaveAttribute("datetime", TIMES.paid);
    expect(row("Processed").querySelector("time")).toHaveTextContent("2 Nov, 9:30 am");
    expect(row("Packed").querySelector("time")).toHaveTextContent("2 Nov, 11:30 am");
  });

  it("shows no time on a pending step, even if one is recorded", () => {
    render(<OrderTimeline status="packed" statusTimes={TIMES} />);
    expect(row("Picked up").querySelector("time")).toBeNull();
  });

  it("shows no time on a completed step with none recorded", () => {
    const { paid, processed, shipped } = TIMES;
    render(<OrderTimeline status="shipped" statusTimes={{ paid, processed, shipped }} />);
    expect(row("Packed").getAttribute("data-complete")).toBe("true");
    expect(row("Packed").querySelector("time")).toBeNull();
  });

  it("shows times on the steps a cancelled order reached", () => {
    render(<OrderTimeline status="cancelled" statusTimes={TIMES} />);
    expect(row("Order placed").querySelector("time")).toHaveTextContent("1 Nov, 10:33 pm");
    expect(row("Processed").querySelector("time")).toBeNull();
  });

  it("maps pickup steps", () => {
    render(<OrderTimeline status="ready_for_pickup" fulfilment="pickup" statusTimes={{ paid: TIMES.paid, ready_for_pickup: TIMES.processed }} />);
    expect(row("Paid").querySelector("time")).toHaveTextContent("1 Nov, 10:33 pm");
    expect(row("Ready for pickup").querySelector("time")).toHaveTextContent("2 Nov, 9:30 am");
    expect(row("Collected").querySelector("time")).toBeNull();
  });

  it("renders without times when the field is absent", () => {
    render(<OrderTimeline status="delivered" />);
    expect(document.querySelector("time")).toBeNull();
  });
});
