import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// Plain functions + mutable state: CRA resetMocks wipes jest.fn implementations.
let mockDetail = null;
let mockNextDetail = null; // returned by getOrder after the first load, when set
let mockActions = [];
let mockActionImpl = null;
let mockToasts = [];
let mockKeyCounter = 0;

jest.mock("../onlineOrdersApi", () => ({
  getOrder: async () => {
    if (mockNextDetail && mockDetail.__loaded) return mockNextDetail;
    mockDetail.__loaded = true;
    return mockDetail;
  },
  action: async (payload) => {
    mockActions.push(payload);
    return mockActionImpl ? mockActionImpl(payload) : { ok: true };
  },
  newOpKey: () => `key-${++mockKeyCounter}`,
}));
jest.mock("sonner", () => ({
  toast: {
    success: (m) => mockToasts.push(["success", m]),
    error: (m, o) => mockToasts.push(["error", m, o?.description]),
  },
}));

import OrderDetail from "../OrderDetail";

const baseOrder = {
  id: "o1",
  order_ref: "WEB-000007",
  created_at: "2026-10-23T10:00:00Z",
  status: "paid",
  contact_name: "Asha",
  contact_phone: "+919999999999",
  contact_email: null,
  address: { line1: "1 MG Road", city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
  subtotal: 2000,
  promo_discount: 0,
  shipping: 99,
  voucher_applied: 0,
  credit_applied: 0,
  gateway_amount: 2099,
  problem: null,
  process_error: null,
};

const item = (over) => ({
  qty: 1,
  stock_taken: 1,
  available_qty: null,
  refunded_qty: 0,
  status: "ordered",
  size: "M",
  color: "Red",
  productid: "BC25001",
  ...over,
});

function detail({ order = {}, items, refunds = [], legs = [], jobs = [], events = [] } = {}) {
  return {
    order: { ...baseOrder, ...order },
    items: items || [
      item({ id: "i1", line_no: 1, product_name: "Kurta", unit_price: 1200, paid_value: 1200 }),
      item({ id: "i2", line_no: 2, product_name: "Dupatta", unit_price: 800, paid_value: 800 }),
    ],
    events,
    refunds,
    legs,
    jobs,
  };
}

beforeEach(() => {
  mockDetail = detail();
  mockNextDetail = null;
  mockActions = [];
  mockActionImpl = null;
  mockToasts = [];
  mockKeyCounter = 0;
});

const processButton = () => screen.getByRole("button", { name: "Process" });
const line = (id) => within(screen.getByTestId(`line-${id}`));

test("shows the money breakdown", async () => {
  mockDetail = detail({
    order: { promo_code: "DIWALI", promo_discount: 200, voucher_code: "V1", voucher_applied: 100, credit_applied: 50, gateway_amount: 1749 },
  });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByText("Promo (DIWALI)")).toBeInTheDocument();
  expect(screen.getByText("Voucher (V1)")).toBeInTheDocument();
  expect(screen.getByText("Store credit")).toBeInTheDocument();
  expect(screen.getByText("Paid online").nextSibling).toHaveTextContent("₹1,749.00");
});

test("Process stays disabled until every line has been set", async () => {
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(processButton()).toBeDisabled();

  fireEvent.click(line("i1").getByRole("button", { name: "Confirm 1" }));
  await waitFor(() => expect(line("i1").getByText("Checked")).toBeInTheDocument());
  expect(processButton()).toBeDisabled();

  fireEvent.click(line("i2").getByRole("button", { name: "Confirm 1" }));
  await waitFor(() => expect(processButton()).toBeEnabled());
  expect(mockActions).toEqual([
    { action: "set_availability", orderId: "o1", itemId: "i1", availableQty: 1 },
    { action: "set_availability", orderId: "o1", itemId: "i2", availableQty: 1 },
  ]);
});

test("confirm dialog lists the unavailable unit and its paid value when 1 of 2 is missing", async () => {
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  fireEvent.click(line("i1").getByRole("button", { name: "Confirm 1" }));
  fireEvent.click(line("i2").getByRole("button", { name: "Fewer available for Dupatta" }));
  await waitFor(() => expect(processButton()).toBeEnabled());
  expect(mockActions[1]).toEqual({ action: "set_availability", orderId: "o1", itemId: "i2", availableQty: 0 });

  fireEvent.click(processButton());
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("1 × Dupatta (M / Red) — ₹800.00");
  expect(within(dialog).getByTestId("refund-total")).toHaveTextContent("₹800.00");
  expect(dialog).not.toHaveTextContent("Kurta");
  expect(dialog).toHaveTextContent("1 unit will be booked");

  fireEvent.click(within(dialog).getByRole("button", { name: "Process" }));
  await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order processed"]));
  expect(mockActions[2]).toEqual({ action: "process", orderId: "o1", opKey: "key-1" });
});

test("refund preview splits paise like the server (remainder on first units)", async () => {
  mockDetail = detail({
    items: [item({ id: "i1", line_no: 1, product_name: "Saree", qty: 3, stock_taken: 3, unit_price: 333.34, paid_value: 1000.01 })],
  });
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Saree");
  fireEvent.click(line("i1").getByRole("button", { name: "Fewer available for Saree" }));
  await waitFor(() => expect(processButton()).toBeEnabled());
  fireEvent.click(processButton());
  // 100001 paise over 3 units → 33334, 33334, 33333; refunding the first unit = 333.34
  expect(await screen.findByTestId("refund-total")).toHaveTextContent("₹333.34");
});

test("409 busy shows the other-staff message and a retry of the click reuses the op key", async () => {
  mockDetail = detail({
    items: [item({ id: "i1", line_no: 1, product_name: "Kurta", unit_price: 1200, paid_value: 1200, available_qty: 1 })],
  });
  mockActionImpl = (p) => {
    if (p.action === "process") throw Object.assign(new Error("busy"), { code: "busy", status: 409 });
    return { ok: true };
  };
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  fireEvent.click(processButton());
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Process" }));
  await waitFor(() =>
    expect(mockToasts).toContainEqual(["error", "Another staff member is working on this order", undefined])
  );
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Process" }));
  await waitFor(() => expect(mockActions.filter((a) => a.action === "process")).toHaveLength(2));
  const keys = mockActions.filter((a) => a.action === "process").map((a) => a.opKey);
  expect(keys).toEqual(["key-1", "key-1"]);
});

test("502 courier_error shows the error and a Retry button", async () => {
  mockDetail = detail({
    items: [item({ id: "i1", line_no: 1, product_name: "Kurta", unit_price: 1200, paid_value: 1200, available_qty: 1 })],
  });
  mockNextDetail = detail({
    order: { status: "processing", process_error: "AWB assignment failed" },
    items: mockDetail.items,
  });
  mockActionImpl = (p) => {
    if (p.action === "process")
      throw Object.assign(new Error("AWB assignment failed"), { code: "courier_error", status: 502 });
    return { ok: true };
  };
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  fireEvent.click(processButton());
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Process" }));
  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(mockToasts).toContainEqual(["error", "Courier error", "AWB assignment failed"]);
  expect(screen.getByText("Process error: AWB assignment failed")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(mockActions).toContainEqual({ action: "retry", orderId: "o1" }));
});

test("Retry is shown for failed jobs", async () => {
  mockDetail = detail({
    order: { status: "paid" },
    jobs: [{ id: "j1", kind: "shiprocket_create", ref_id: "", status: "failed", last_error: "timeout" }],
  });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.getByText(/Failed job shiprocket_create/)).toHaveTextContent("timeout");
});

test("cancel requires a reason", async () => {
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
  const dialog = await screen.findByRole("dialog");
  const confirm = within(dialog).getByRole("button", { name: "Cancel order" });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Cancel reason"), { target: { value: "   " } });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Cancel reason"), {
    target: { value: " Customer asked " },
  });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(mockActions).toContainEqual({
      action: "cancel",
      orderId: "o1",
      opKey: "key-1",
      reason: "Customer asked",
    })
  );
});

test("rto order offers Parcel received back; shows shipment links and refunds", async () => {
  mockDetail = detail({
    order: {
      status: "rto",
      awb: "AWB123",
      courier_name: "Delhivery",
      label_url: "https://x/label.pdf",
      manifest_url: "https://x/manifest.pdf",
      bill_id: 42,
    },
    refunds: [{ id: "r1", reason: "unavailable", units: 1, total_amount: 800, status: "processing", choice: "original" }],
    legs: [{ id: "l1", refund_id: "r1", source: "gateway", amount: 800, status: "processing", destination: "original" }],
    events: [{ id: 1, kind: "paid", from_status: "pending_payment", to_status: "paid", created_at: "2026-10-23T10:00:00Z" }],
  });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByRole("link", { name: "Shipping label" })).toHaveAttribute("href", "https://x/label.pdf");
  expect(screen.getByRole("link", { name: "Manifest" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Bill of Supply #42" })).toBeInTheDocument();
  expect(screen.getByText(/gateway ₹800.00 → original · processing/)).toBeInTheDocument();
  expect(screen.getByText("paid (pending_payment → paid)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Parcel received back" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Parcel received back" }));
  await waitFor(() => expect(mockActions).toContainEqual({ action: "rto_received", orderId: "o1" }));
});
