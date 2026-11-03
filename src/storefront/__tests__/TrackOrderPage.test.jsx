import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { supabase } from "lib/supabaseClient";
import TrackOrderPage from "../pages/TrackOrderPage";

jest.mock("lib/supabaseClient", () => ({
  supabase: {
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
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
  fireEvent.change(screen.getByLabelText(/order number/i), { target: { value: ref } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: phone } });
  fireEvent.click(screen.getByRole("button", { name: /check status/i }));
}

describe("TrackOrderPage", () => {
  it("adds packed photos once found, asking with the same order and phone", async () => {
    supabase.rpc.mockResolvedValue({ data: DELIVERED, error: null });
    supabase.functions.invoke.mockResolvedValue({ data: { photos: ["https://x.test/a.jpg"] }, error: null });
    renderPage();
    submit("WEB-000007", "09812345678");
    expect(await screen.findByAltText("Your packed order, view 1")).toHaveAttribute("src", "https://x.test/a.jpg");
    expect(supabase.functions.invoke).toHaveBeenCalledWith("order-packed-photos", {
      body: { orderRef: "WEB-000007", phone: "9812345678" },
    });
  });

  it("still shows the order when packed photos fail, and does not ask before packing", async () => {
    supabase.rpc.mockResolvedValue({ data: DELIVERED, error: null });
    supabase.functions.invoke.mockRejectedValue(new Error("down"));
    renderPage();
    submit("WEB-000007", "9812345678");
    expect(await screen.findByText("Delivered", { selector: "p" })).toBeInTheDocument();
    supabase.functions.invoke.mockClear();
    fireEvent.click(await screen.findByRole("button", { name: /track another/i }));
    supabase.rpc.mockResolvedValue({ data: { ...DELIVERED, status: "paid" }, error: null });
    submit("WEB-000007", "9812345678");
    await screen.findByRole("button", { name: /track another/i });
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("renders heading, order-ref and phone inputs, and a submit button", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /track your order/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/order number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone number used at checkout/i)).toHaveAttribute("placeholder", "10-digit mobile number");
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
      ["✓Order placed", "✓Processed", "✓Packed", "✓Picked up", "✓Out for delivery", "✓Delivered"]
    );
    steps.forEach((s) => expect(s).toHaveAttribute("data-complete", "true"));
    expect(screen.getByRole("link", { name: "See detailed tracking on Shiprocket" })).toHaveAttribute("href", "https://shiprocket.co/tracking/AWB1");
    expect(screen.getByText("Silk Saree (FREE/Red) ×2")).toBeInTheDocument();
  });

  describe.each(["shiprocket", null, "porter", "self"])("courier %s", (courier) => {
    it.each([
      ["paid", "Order placed", 1],
      ["cancelling", "Order placed", 1],
      ["processing", "Processed", 2],
      ["processed", "Processed", 2],
      ["packed", "Packed", 3],
      ["shipped", "Picked up", 4],
      ["out_for_delivery", "Out for delivery", 5],
      ["delivered", "Delivered", 6],
    ])("%s reads %s and ticks %i of six steps", async (status, label, ticked) => {
      supabase.rpc.mockResolvedValue({ data: { ...DELIVERED, status, courier, tracking_url: null }, error: null });
      renderPage();
      submit("WEB-000007", "9810873280");
      const progress = await screen.findByRole("list", { name: /order progress/i });
      const steps = within(progress).getAllByRole("listitem");
      expect(steps.map((s) => s.textContent.replace(/^(✓|\d)/, "").replace(/\s*\((done|pending)\)/, ""))).toEqual(
        ["Order placed", "Processed", "Packed", "Picked up", "Out for delivery", "Delivered"]
      );
      expect(steps.map((s) => s.getAttribute("data-complete") === "true")).toEqual(steps.map((_, i) => i < ticked));
      expect(screen.getByText(label, { selector: "p" })).toBeInTheDocument();
    });
  });

  it("shows no tracking link before Shiprocket has an AWB", async () => {
    supabase.rpc.mockResolvedValue({
      data: { ...DELIVERED, status: "processing", courier: "shiprocket", awb: null, tracking_url: null },
      error: null,
    });
    renderPage();
    submit("WEB-000007", "9810873280");
    await screen.findByRole("list", { name: /order progress/i });
    expect(screen.queryByRole("link", { name: /detailed tracking/i })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: /detailed tracking/i })).not.toBeInTheDocument();
  });

  it("shows step times, courier, destination and photo from the lookup", async () => {
    supabase.rpc.mockResolvedValue({
      data: {
        ...DELIVERED,
        status: "shipped",
        courier_name: "Amazon Shipping Surface 1kg",
        delivery_city: "Ghaziabad",
        delivery_pincode: "201001",
        status_times: { paid: "2026-11-01T17:03:00+00:00", shipped: "2026-11-02T06:00:00+00:00" },
        items: [{ ...DELIVERED.items[0], image_url: "https://img.test/a.webp" }],
      },
      error: null,
    });
    renderPage();
    submit("WEB-000007", "9810873280");
    expect(await screen.findByText("1 Nov, 10:33 pm")).toBeInTheDocument();
    expect(screen.getByText("2 Nov, 11:30 am")).toBeInTheDocument();
    expect(screen.getByText("Delivery by Amazon Shipping Surface")).toBeInTheDocument();
    expect(screen.getByText("Delivering to Ghaziabad, 201001")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Silk Saree" })).toHaveAttribute("src", "https://img.test/a.webp");
  });
});
