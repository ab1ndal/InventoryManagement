import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import TrackOrderPage from "../pages/TrackOrderPage";

jest.mock("lib/supabaseClient", () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));


const DELIVERED = {
  order_ref: "WEB-000007", status: "delivered", created_at: "2026-10-20T10:00:00Z",
  subtotal: 3000, promo_discount: 0, shipping: 80, voucher_applied: 0, credit_applied: 0, gateway_amount: 3080,
  courier_name: "Delhivery", awb: "AWB1", tracking_url: "https://shiprocket.co/tracking/AWB1",
  items: [{ name: "Silk Saree", size: "FREE", color: "Red", qty: 2, unit_price: 1500, status: "shipped", refunded_qty: 0 }],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TrackOrderPage />
    </MemoryRouter>
  );
}

function submit(ref, phone) {
  fireEvent.change(screen.getByLabelText(/order reference/i), { target: { value: ref } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: /check status/i }));
}

describe("TrackOrderPage", () => {
  it("renders heading, order-ref and phone inputs, and a submit button", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /track your order/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/order reference/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check status/i })).toBeInTheDocument();
  });

  it("says it couldn't find the order when ref and phone don't match", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    renderPage();
    submit("WEB-000007", "9999999999");
    expect(await screen.findByText(/We couldn't find that order/)).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("online_order_lookup", { p_order_ref: "WEB-000007", p_phone: "9999999999" });
  });

  it("shows a delivered order with every step ticked and the courier link", async () => {
    supabase.rpc.mockResolvedValue({ data: DELIVERED, error: null });
    renderPage();
    submit("WEB-000007", "9810873280");
    const progress = await screen.findByRole("list", { name: /order progress/i });
    const steps = within(progress).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent.replace(/\s*\((done|pending)\)/, ""))).toEqual(
      ["✓Paid", "✓Packed", "✓Shipped", "✓Out for delivery", "✓Delivered"]
    );
    steps.forEach((s) => expect(s).toHaveAttribute("data-complete", "true"));
    expect(screen.getByRole("link", { name: /track with the courier/i })).toHaveAttribute("href", "https://shiprocket.co/tracking/AWB1");
    expect(screen.getByText("Silk Saree (FREE/Red) ×2")).toBeInTheDocument();
  });

  it("shows a collected store-pickup order without a courier link", async () => {
    supabase.rpc.mockResolvedValue({
      data: { ...DELIVERED, fulfilment: "pickup", shipping: 0, gateway_amount: 3000, courier_name: null, awb: null, tracking_url: null },
      error: null,
    });
    renderPage();
    submit("WEB-000007", "9810873280");
    const progress = await screen.findByRole("list", { name: /order progress/i });
    const steps = within(progress).getAllByRole("listitem");
    expect(steps.map((s) => s.textContent.replace(/\s*\((done|pending)\)/, ""))).toEqual(["✓Paid", "✓Ready for pickup", "✓Collected"]);
    expect(screen.getByText("Collected", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /track with the courier/i })).not.toBeInTheDocument();
  });
});
