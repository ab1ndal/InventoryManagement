import React from "react";
import { render, screen } from "@testing-library/react";
import OrderDelivery from "../components/OrderDelivery";

const SHIP = {
  status: "shipped",
  fulfilment: "ship",
  courierName: "Amazon Shipping Surface 1kg",
  city: "Ghaziabad",
  pincode: "201001",
};

it("names the courier without its weight slab, and the destination", () => {
  render(<OrderDelivery {...SHIP} />);
  expect(screen.getByText("Delivery by Amazon Shipping Surface")).toBeInTheDocument();
  expect(screen.getByText("Delivering to Ghaziabad, 201001")).toBeInTheDocument();
});

it("names the shop on a self delivery", () => {
  render(<OrderDelivery {...SHIP} courierName="Bindal's Creation" />);
  expect(screen.getByText("Delivery by Bindal's Creation")).toBeInTheDocument();
});

it("shows the destination alone before a courier is set", () => {
  render(<OrderDelivery {...SHIP} status="paid" courierName={null} />);
  expect(screen.queryByText(/Delivery by/)).not.toBeInTheDocument();
  expect(screen.getByText("Delivering to Ghaziabad, 201001")).toBeInTheDocument();
});

it("says Delivered to once it has arrived", () => {
  render(<OrderDelivery {...SHIP} status="delivered" />);
  expect(screen.getByText("Delivered to Ghaziabad, 201001")).toBeInTheDocument();
});

it("shows only what it has of the destination", () => {
  render(<OrderDelivery {...SHIP} city={null} />);
  expect(screen.getByText("Delivering to 201001")).toBeInTheDocument();
});

it("hides courier and destination on a cancelled order", () => {
  const { container } = render(<OrderDelivery {...SHIP} status="cancelled" />);
  expect(container).toBeEmptyDOMElement();
});

it("shows the carrier and tracking number the shop typed on a manual delivery", () => {
  render(<OrderDelivery {...SHIP} courierName="India Post" trackingNumber="EE123456789IN" />);
  expect(screen.getByText("Delivery by India Post")).toBeInTheDocument();
  expect(screen.getByText("Tracking number: EE123456789IN")).toBeInTheDocument();
});

it("shows no tracking line without a number, and none on a cancelled order", () => {
  const { rerender, container } = render(<OrderDelivery {...SHIP} />);
  expect(screen.queryByText(/Tracking number/)).not.toBeInTheDocument();
  rerender(<OrderDelivery {...SHIP} status="cancelled" trackingNumber="EE1" />);
  expect(container).toBeEmptyDOMElement();
});

it.each(["rto", "rto_received"])("keeps the courier but drops the destination at %s", (status) => {
  render(<OrderDelivery {...SHIP} status={status} />);
  expect(screen.getByText("Delivery by Amazon Shipping Surface")).toBeInTheDocument();
  expect(screen.queryByText(/Deliver(ing|ed) to/)).not.toBeInTheDocument();
});

it.each(["pending_payment", "payment_failed", "expired"])("shows nothing for an order never paid: %s", (status) => {
  const { container } = render(<OrderDelivery {...SHIP} status={status} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows nothing for pickup", () => {
  const { container } = render(<OrderDelivery {...SHIP} status="ready_for_pickup" fulfilment="pickup" />);
  expect(container).toBeEmptyDOMElement();
});

it("shows nothing when the fields are absent, as from an old handler", () => {
  const { container } = render(<OrderDelivery status="shipped" fulfilment="ship" />);
  expect(container).toBeEmptyDOMElement();
});

it("asks for a Google review once delivered, and not before", () => {
  const { rerender } = render(<OrderDelivery {...SHIP} />);
  expect(screen.queryByRole("link", { name: /review us/i })).not.toBeInTheDocument();
  rerender(<OrderDelivery {...SHIP} status="delivered" />);
  expect(screen.getByRole("link", { name: /review us on google/i })).toHaveAttribute(
    "href",
    "https://g.page/r/CayP03i6bmA3EBE/review"
  );
});

it("asks for a review on a collected pickup order, and shows nothing before that", () => {
  const { rerender, container } = render(<OrderDelivery status="ready_for_pickup" fulfilment="pickup" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<OrderDelivery status="delivered" fulfilment="pickup" />);
  expect(screen.getByRole("link", { name: /review us on google/i })).toBeInTheDocument();
});
