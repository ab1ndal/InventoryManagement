import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import OrderDetail from "../OrderDetail";

// Plain functions + mutable state: CRA resetMocks wipes jest.fn implementations.
let mockDetail = null;
let mockNextDetail = null; // returned by getOrder after the first load, when set
let mockActions = [];
let mockActionImpl = null;
let mockToasts = [];
let mockKeyCounter = 0;
let mockRole = "admin";
let mockGenerated = [];
let mockGenerateImpl = null;
let mockOpened = [];
let mockGetOrderError = null;

jest.mock("../../billing/useBillPdf", () => ({
  useBillPdf: () => ({
    generate: async (billId) => {
      mockGenerated.push(billId);
      return mockGenerateImpl ? mockGenerateImpl(billId) : "bill-new.pdf";
    },
    offscreen: null,
  }),
}));
jest.mock("../../billing/billPdf", () => ({
  openBillPdf: async (path) => mockOpened.push(path),
}));
jest.mock("../onlineOrdersApi", () => ({
  getOrder: async () => {
    if (mockGetOrderError) throw mockGetOrderError;
    if (mockNextDetail && mockDetail.__loaded) return mockNextDetail;
    mockDetail.__loaded = true;
    return mockDetail;
  },
  action: async (payload) => {
    mockActions.push(payload);
    return mockActionImpl ? mockActionImpl(payload) : { ok: true };
  },
  newOpKey: () => `key-${++mockKeyCounter}`,
  getMyRole: async () => mockRole,
}));
jest.mock("sonner", () => ({
  toast: {
    success: (m) => mockToasts.push(["success", m]),
    error: (m, o) => mockToasts.push(["error", m, o?.description]),
  },
}));


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

function detail({ order = {}, bill = null, items, refunds = [], legs = [], jobs = [], events = [] } = {}) {
  return {
    order: { ...baseOrder, ...order },
    bill,
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
  mockRole = "admin";
  mockGetOrderError = null;
});

const processButton = () => screen.getByRole("button", { name: "Process" });
const line = (id) => within(screen.getByTestId(`line-${id}`));

test("the customer's phone number can be tapped to call", async () => {
  mockDetail = detail();
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByRole("link", { name: "+919999999999" })).toHaveAttribute("href", "tel:+919999999999");
});

test("shows the money breakdown", async () => {
  mockDetail = detail({
    order: { promo_code: "DIWALI", promo_discount: 200, voucher_code: "V1", voucher_applied: 100, credit_applied: 50, gateway_amount: 1749 },
  });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByText("Promo (DIWALI)")).toBeInTheDocument();
  expect(screen.getByText("Voucher (V1)")).toBeInTheDocument();
  expect(screen.getByText("Store credit")).toBeInTheDocument();
  // The amount sits in the cell beside its label; no role ties the two.
  // eslint-disable-next-line testing-library/no-node-access
  expect(screen.getByText("Paid online").nextSibling).toHaveTextContent("₹1,749.00");
});

test("shows an Outside UP badge only for an address outside Uttar Pradesh", async () => {
  const { unmount } = render(<OrderDetail orderId="o1" />);
  await screen.findByText("WEB-000007");
  expect(screen.queryByText("Outside UP")).not.toBeInTheDocument();
  unmount();
  mockDetail = detail({ order: { address: { line1: "12 Marine Drive", city: "Mumbai", state: "Maharashtra", pincode: "400001" } } });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByText("Outside UP")).toBeInTheDocument();
});

test("address shows the landmark when the shopper gave one", async () => {
  mockDetail = detail({
    order: { address: { line1: "Flat 4", line2: "Sector 5", landmark: "Near Durga Bhabhi Chowk", city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" } },
  });
  render(<OrderDetail orderId="o1" />);
  expect(
    await screen.findByText("Flat 4, Sector 5, Landmark: Near Durga Bhabhi Chowk, Lucknow, Uttar Pradesh, 226001")
  ).toBeInTheDocument();
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
  fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
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
  fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
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
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Process" }));
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
  expect(screen.getByText("Bill of Supply #42")).toBeInTheDocument();
  expect(screen.getByText(/gateway ₹800.00 → original · processing/)).toBeInTheDocument();
  expect(screen.getByText("Payment received")).toBeInTheDocument();
  expect(screen.getByText("· now To check")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Parcel received back" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Parcel received back" }));
  await waitFor(() => expect(mockActions).toContainEqual({ action: "rto_received", orderId: "o1" }));
});

const stuck = (over = {}) => ({
  status: "processing",
  op_action: "process",
  op_lease_until: "2020-01-01T00:00:00Z",
  process_error: "AWB assignment failed",
  awb: "AWB9",
  ...over,
});

test("Send back shown on processing order with error and expired lease", async () => {
  mockDetail = detail({ order: stuck() });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Send back to To-check" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(
    "Cancels the courier booking (AWB AWB9) and returns this order to To-check. Refunds already made stay."
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
  await waitFor(() =>
    expect(mockActions).toContainEqual({ action: "send_back", orderId: "o1", opKey: "key-1" })
  );
});

test("Send back hidden on packed, and when the lease is still live", async () => {
  mockDetail = detail({ order: { status: "packed", awb: "A1", op_action: null, op_lease_until: null } });
  const { unmount } = render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(screen.queryByRole("button", { name: "Send back to To-check" })).not.toBeInTheDocument();
  unmount();
  mockDetail = detail({ order: stuck({ op_lease_until: "2999-01-01T00:00:00Z" }) });
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(screen.queryByRole("button", { name: "Send back to To-check" })).not.toBeInTheDocument();
});

test("Rebook on shipped requires note", async () => {
  mockDetail = detail({ order: { status: "shipped", awb: "AWB9" } });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Rebook…" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(
    "Cancels AWB AWB9. Parcel still at shop: re-send the same pieces. Parcel lost: take new pieces from stock; anything we can't replace is refunded."
  );
  const confirm = within(dialog).getByRole("button", { name: "Rebook" });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByLabelText("Rebook note"), { target: { value: " Wrong size " } });
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(mockActions).toContainEqual({
      action: "rebook",
      orderId: "o1",
      opKey: "key-1",
      parcelLost: false,
      note: "Wrong size",
    })
  );
});

test("parcel lost sends parcelLost true", async () => {
  mockDetail = detail({ order: { status: "out_for_delivery", awb: "AWB9" } });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Rebook…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByLabelText("Parcel lost"));
  fireEvent.change(within(dialog).getByLabelText("Rebook note"), { target: { value: "Lost in transit" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebook" }));
  await waitFor(() =>
    expect(mockActions).toContainEqual(expect.objectContaining({ action: "rebook", parcelLost: true }))
  );
});

const courierFail = (p) => {
  if (p.manualCancelConfirmed) return { ok: true };
  throw Object.assign(new Error("Cancel AWB AWB9 / Shiprocket order WEB-000007 in Shiprocket dashboard"), {
    code: "courier_error",
    status: 502,
  });
};

async function rebookUntilCourierError() {
  mockDetail = detail({ order: { status: "shipped", awb: "AWB9" } });
  mockActionImpl = courierFail;
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Rebook…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Rebook note"), { target: { value: "n" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebook" }));
  return dialog;
}

test("courier_error shows problem text; no manual button for admin", async () => {
  await rebookUntilCourierError();
  const dialog = screen.getByRole("dialog");
  expect(
    await within(dialog).findByText("Cancel AWB AWB9 / Shiprocket order WEB-000007 in Shiprocket dashboard")
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "I cancelled it in Shiprocket" })).not.toBeInTheDocument();
});

test("courier_error for superadmin offers I cancelled it in Shiprocket, resent with the same opKey", async () => {
  mockRole = "superadmin";
  await rebookUntilCourierError();
  fireEvent.click(await screen.findByRole("button", { name: "I cancelled it in Shiprocket" }));
  await waitFor(() => expect(mockActions.filter((a) => a.action === "rebook")).toHaveLength(2));
  const [first, second] = mockActions.filter((a) => a.action === "rebook");
  expect(second).toEqual({ ...first, manualCancelConfirmed: true });
  expect(second.opKey).toBe("key-1");
});

const RELEASE_TEXT =
  "Releases this order without cancelling the courier booking. Use only if the booking was not cancelled.";

test("send back left claimed after a courier error can be resumed once its lease expires (new opKey)", async () => {
  mockDetail = detail({ order: stuck({ op_action: "send_back", process_error: null }) });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume send back" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
  await waitFor(() =>
    expect(mockActions).toContainEqual({ action: "send_back", orderId: "o1", opKey: "key-1" })
  );
});

test("send back claim with a live lease: no resume, no abandon", async () => {
  mockDetail = detail({ order: stuck({ op_action: "send_back", op_lease_until: "2999-01-01T00:00:00Z" }) });
  render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(screen.queryByRole("button", { name: "Resume send back" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Abandon" })).not.toBeInTheDocument();
});

test("rebook claim: hidden while its lease is live, Resume rebook… once expired", async () => {
  mockDetail = detail({
    order: { status: "shipped", awb: "AWB9", op_action: "rebook", op_lease_until: "2999-01-01T00:00:00Z" },
  });
  const { unmount } = render(<OrderDetail orderId="o1" />);
  await screen.findByText("Kurta");
  expect(screen.queryByRole("button", { name: /Rebook…/ })).not.toBeInTheDocument();
  unmount();
  mockDetail = detail({
    order: { status: "shipped", awb: "AWB9", op_action: "rebook", op_lease_until: "2020-01-01T00:00:00Z" },
  });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Resume rebook…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Rebook note"), { target: { value: "again" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Rebook" }));
  await waitFor(() =>
    expect(mockActions).toContainEqual(expect.objectContaining({ action: "rebook", opKey: "key-1", note: "again" }))
  );
});

test("Abandon next to the resume button confirms, then sends release_op with a new opKey", async () => {
  mockDetail = detail({
    order: { status: "shipped", awb: "AWB9", op_action: "rebook", op_lease_until: "2020-01-01T00:00:00Z" },
  });
  render(<OrderDetail orderId="o1" />);
  fireEvent.click(await screen.findByRole("button", { name: "Abandon" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(RELEASE_TEXT);
  expect(dialog).toHaveTextContent("Abandon rebook of WEB-000007?");
  expect(mockActions).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Abandon" }));
  await waitFor(() => expect(mockActions).toContainEqual({ action: "release_op", orderId: "o1", opKey: "key-1" }));
});

test("Abandon not offered for a plain stalled Process", async () => {
  mockDetail = detail({ order: stuck() });
  render(<OrderDetail orderId="o1" />);
  await screen.findByRole("button", { name: "Send back to To-check" });
  expect(screen.queryByRole("button", { name: "Abandon" })).not.toBeInTheDocument();
});

test("after a courier error the dialog offers Abandon with the dialog's opKey", async () => {
  await rebookUntilCourierError();
  const dialog = screen.getByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("button", { name: "Abandon" }));
  const confirm = await screen.findByRole("dialog");
  expect(confirm).toHaveTextContent(RELEASE_TEXT);
  expect(confirm).toHaveTextContent("Abandon rebook of WEB-000007?");
  mockActionImpl = null;
  fireEvent.click(within(confirm).getByRole("button", { name: "Abandon" }));
  await waitFor(() => expect(mockActions).toContainEqual({ action: "release_op", orderId: "o1", opKey: "key-1" }));
});

describe("Mark delivered", () => {
  const shipped = () => {
    mockDetail = detail({ order: { status: "shipped", delivered_at: null } });
  };
  const btn = () => screen.queryByRole("button", { name: "Mark delivered…" });

  test("hidden for an admin", async () => {
    shipped();
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    await waitFor(() => expect(mockRole).toBe("admin"));
    expect(btn()).not.toBeInTheDocument();
  });

  test("hidden for a superadmin when the order is not shipped / out for delivery", async () => {
    mockRole = "superadmin";
    mockDetail = detail({ order: { status: "packed" } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(btn()).not.toBeInTheDocument();
  });

  test.each(["shipped", "out_for_delivery"])("superadmin on %s needs a reason, sends ISO date", async (status) => {
    mockRole = "superadmin";
    mockDetail = detail({ order: { status, delivered_at: null } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(await screen.findByRole("button", { name: "Mark delivered…" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Mark delivered" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Delivered at"), { target: { value: "2026-10-20T10:00" } });
    fireEvent.change(within(dialog).getByLabelText("Delivery reason"), { target: { value: " Customer confirmed on call " } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mockActions).toHaveLength(1));
    expect(mockActions[0]).toEqual({
      action: "mark_delivered",
      orderId: "o1",
      deliveredAt: "2026-10-20T04:30:00.000Z",
      reason: "Customer confirmed on call",
    });
  });

  test("Delivered at min rounds the payment time up a minute plus one of slack", async () => {
    mockRole = "superadmin";
    // far-future payment so the paid_at bound always beats the 30-day bound
    mockDetail = detail({ order: { status: "shipped", delivered_at: null, paid_at: "2099-01-01T10:00:30Z" } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(await screen.findByRole("button", { name: "Mark delivered…" }));
    const input = within(await screen.findByRole("dialog")).getByLabelText("Delivered at");
    expect(input).toHaveAttribute("min", "2099-01-01T15:32");
  });

  test("a server refusal keeps the dialog open with the message and the typed reason", async () => {
    mockRole = "superadmin";
    mockDetail = detail({ order: { status: "shipped", delivered_at: null } });
    mockActionImpl = () => {
      throw Object.assign(new Error("delivered date cannot be more than 30 days ago"), { code: "bad_state" });
    };
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(await screen.findByRole("button", { name: "Mark delivered…" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Delivery reason"), { target: { value: "Called customer" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark delivered" }));
    await waitFor(() => expect(dialog).toHaveTextContent("delivered date cannot be more than 30 days ago"));
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByLabelText("Delivery reason")).toHaveValue("Called customer");
  });
});

test("a delivered order shows the Returns section", async () => {
  mockDetail = detail({ order: { status: "delivered", delivered_at: "2026-10-20T10:00:00Z", returns: [] } });
  render(<OrderDetail orderId="o1" />);
  expect(await screen.findByRole("heading", { name: "Returns" })).toBeInTheDocument();
});

test("a return action refreshes the list through onChanged", async () => {
  mockDetail = detail({
    order: {
      status: "delivered",
      delivered_at: new Date().toISOString(),
      returns: [
        {
          id: "r1", order_id: "o1", reason: "change_of_mind", status: "open", contacted_at: new Date().toISOString(),
          note: "n", items: [{ return_id: "r1", item_id: "i1", units: 1 }], photos: [],
        },
      ],
    },
  });
  const onChanged = jest.fn();
  render(<OrderDetail orderId="o1" onChanged={onChanged} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel return…" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Cancel note"), { target: { value: "no" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel return" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
});

describe("store pickup", () => {
  const pickupAddress = { name: "Asha", phone: "+919999999999" };
  const pickup = (order = {}, rest = {}) =>
    detail({ order: { fulfilment: "pickup", shipping: 0, gateway_amount: 2000, address: pickupAddress, ...order }, ...rest });
  const shipOnly = ["Process", "Rebook…", "Mark delivered…", "Parcel received back", "Send back to To-check"];

  test("paid: Store pickup badge, contact as address, no Outside UP, Ready for pickup gated like Process", async () => {
    mockDetail = pickup();
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByText("Store pickup")).toBeInTheDocument();
    expect(screen.getByText("Asha, +919999999999")).toBeInTheDocument();
    expect(screen.queryByText("Outside UP")).not.toBeInTheDocument();
    for (const name of shipOnly) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collected" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();

    const ready = screen.getByRole("button", { name: "Ready for pickup" });
    expect(ready).toBeDisabled();
    fireEvent.click(line("i1").getByRole("button", { name: "Confirm 1" }));
    fireEvent.click(line("i2").getByRole("button", { name: "Fewer available for Dupatta" }));
    await waitFor(() => expect(ready).toBeEnabled());

    fireEvent.click(ready);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("1 unit will be kept for the customer");
    expect(within(dialog).getByTestId("refund-total")).toHaveTextContent("₹800.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ready for pickup" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order ready for pickup"]));
    expect(mockActions[2]).toEqual({ action: "mark_ready", orderId: "o1" });
  });

  test("paid with nothing available: Ready for pickup offers cancel and refund", async () => {
    mockDetail = pickup({}, { items: [item({ id: "i1", line_no: 1, product_name: "Kurta", paid_value: 1200, available_qty: 0 })] });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(screen.getByRole("button", { name: "Ready for pickup" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Nothing is available: the order will be cancelled and fully refunded.");
    expect(within(dialog).getByTestId("refund-total")).not.toHaveTextContent("incl. shipping");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order cancelled and refunded"]));
    expect(mockActions).toEqual([{ action: "mark_ready", orderId: "o1" }]);
  });

  test("ready_for_pickup: Collected confirms then sends mark_collected; Cancel still offered", async () => {
    mockDetail = pickup({ status: "ready_for_pickup", bill_id: 42 });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByText("Ready for pickup")).toBeInTheDocument(); // status badge
    expect(screen.queryByRole("button", { name: "Ready for pickup" })).not.toBeInTheDocument();
    for (const name of shipOnly) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel order" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collected" }));
    const dialog = await screen.findByRole("dialog");
    expect(mockActions).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Collected" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order marked collected"]));
    expect(mockActions).toEqual([{ action: "mark_collected", orderId: "o1" }]);
  });

  test("ready_for_pickup: cancel sends the existing cancel payload", async () => {
    mockDetail = pickup({ status: "ready_for_pickup" });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("shipping charge");
    fireEvent.change(within(dialog).getByLabelText("Cancel reason"), { target: { value: "No show" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() =>
      expect(mockActions).toContainEqual({ action: "cancel", orderId: "o1", opKey: "key-1", reason: "No show" })
    );
  });

  test("a delivered pickup order reads Collected", async () => {
    mockDetail = pickup({ status: "delivered", delivered_at: "2026-10-20T10:00:00Z", returns: [] });
    render(<OrderDetail orderId="o1" />);
    expect(await screen.findByText("Collected")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collected" })).not.toBeInTheDocument();
  });

  test("a paid ship order offers Process, not the pickup actions", async () => {
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByRole("button", { name: "Process" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ready for pickup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collected" })).not.toBeInTheDocument();
    expect(screen.queryByText("Store pickup")).not.toBeInTheDocument();
  });
});

describe("manual delivery", () => {
  const checkedItems = () => [
    item({ id: "i1", line_no: 1, product_name: "Kurta", unit_price: 1200, paid_value: 1200, available_qty: 1 }),
    item({ id: "i2", line_no: 2, product_name: "Dupatta", unit_price: 800, paid_value: 800, available_qty: 0 }),
  ];
  const openProcess = async () => {
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    fireEvent.click(processButton());
    return screen.findByRole("dialog");
  };
  const manual = (status, courier = "porter", over = {}) =>
    detail({
      order: {
        status,
        courier,
        courier_name: courier === "porter" ? "Porter" : "Bindal's Creation",
        delivered_at: null,
        ...over,
      },
    });
  const stepNames = ["Packed", "Picked up", "Out for delivery", "Delivered"];
  const shownSteps = () => stepNames.filter((name) => screen.queryByRole("button", { name }));
  const openAt = async (status, courier) => {
    mockDetail = manual(status, courier);
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
  };

  test("Process offers Self delivery (preselected), Porter and Shiprocket, with no link field", async () => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    expect(within(dialog).getAllByRole("radio").map((r) => r.closest("label").textContent)).toEqual([
      "Self delivery",
      "Porter (manual)",
      "Shiprocket",
    ]);
    expect(within(dialog).getByRole("radio", { name: "Self delivery" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Porter (manual)" })).not.toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "Shiprocket" })).not.toBeChecked();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
    expect(dialog).toHaveTextContent("1 unit will be booked with the courier");
  });

  test.each([
    ["Porter (manual)", "porter"],
    ["Self delivery", "self"],
  ])("%s sends manual_process with no link", async (radio, courier) => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: radio }));
    expect(dialog).toHaveTextContent(
      "1 unit will be marked processed. Book or arrange the delivery yourself; the customer follows the status on our website."
    );
    // same refund preview as Process: the missing Dupatta is refunded
    expect(within(dialog).getByTestId("refund-total")).toHaveTextContent("₹800.00");
    fireEvent.click(within(dialog).getByRole("button", { name: "Process" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order processed"]));
    expect(mockActions).toEqual([{ action: "manual_process", orderId: "o1", courier }]);
  });

  test("the plural reads units", async () => {
    mockDetail = detail({
      items: [item({ id: "i1", line_no: 1, product_name: "Kurta", qty: 2, stock_taken: 2, paid_value: 2400, available_qty: 2 })],
    });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Self delivery" }));
    expect(dialog).toHaveTextContent("2 units will be marked processed.");
  });

  test("nothing available: manual Process offers Cancel and refund", async () => {
    mockDetail = detail({ items: [item({ id: "i1", line_no: 1, product_name: "Kurta", paid_value: 1200, available_qty: 0 })] });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Self delivery" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order cancelled and refunded"]));
    expect(mockActions).toEqual([{ action: "manual_process", orderId: "o1", courier: "self" }]);
  });

  test("Shiprocket still sends process with an op key", async () => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Process" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order processed"]));
    expect(mockActions).toEqual([{ action: "process", orderId: "o1", opKey: "key-1" }]);
  });

  test("closing the dialog resets the choice to Self delivery", async () => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Shiprocket" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(processButton());
    expect(within(await screen.findByRole("dialog")).getByRole("radio", { name: "Self delivery" })).toBeChecked();
  });

  test.each([
    ["processed", ["Packed", "Picked up", "Out for delivery", "Delivered"]],
    ["packed", ["Picked up", "Out for delivery", "Delivered"]],
    ["shipped", ["Out for delivery", "Delivered"]],
    ["out_for_delivery", ["Delivered"]],
    ["delivered", []],
  ])("%s shows the remaining steps in order, first one primary", async (status, steps) => {
    await openAt(status, "self");
    expect(shownSteps()).toEqual(steps);
    steps.forEach((name, i) => {
      const button = screen.getByRole("button", { name });
      if (i === 0) expect(button).toHaveClass("bg-primary");
      else expect(button).not.toHaveClass("bg-primary");
    });
  });

  test("the steps are not offered on a Shiprocket or legacy null-courier order", async () => {
    mockDetail = detail({ order: { status: "packed", courier: "shiprocket" } });
    const { unmount } = render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(shownSteps()).toEqual([]);
    unmount();
    mockDetail = detail({ order: { status: "shipped", courier: null } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(shownSteps()).toEqual([]);
  });

  test("Packed runs directly", async () => {
    await openAt("processed");
    fireEvent.click(screen.getByRole("button", { name: "Packed" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order marked packed"]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockActions).toEqual([{ action: "manual_advance", orderId: "o1", target: "packed" }]);
  });

  test("Out for delivery after Picked up runs directly", async () => {
    await openAt("shipped");
    fireEvent.click(screen.getByRole("button", { name: "Out for delivery" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order marked out for delivery"]));
    expect(mockActions).toEqual([{ action: "manual_advance", orderId: "o1", target: "out_for_delivery" }]);
  });

  test.each(["processed", "packed"])("Picked up from %s confirms first", async (status) => {
    await openAt(status);
    fireEvent.click(screen.getByRole("button", { name: "Picked up" }));
    const dialog = await screen.findByRole("dialog");
    expect(mockActions).toEqual([]);
    expect(dialog).toHaveTextContent("Mark WEB-000007 picked up?");
    expect(dialog).toHaveTextContent(
      "Picked up creates the Bill of Supply, emails the customer and means the order can no longer be cancelled."
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order marked picked up"]));
    expect(mockActions).toEqual([{ action: "manual_advance", orderId: "o1", target: "shipped" }]);
  });

  test.each(["processed", "packed"])("Out for delivery from %s skips Picked up, so it confirms too", async (status) => {
    await openAt(status);
    fireEvent.click(screen.getByRole("button", { name: "Out for delivery" }));
    const dialog = await screen.findByRole("dialog");
    expect(mockActions).toEqual([]);
    expect(dialog).toHaveTextContent("This also marks the order picked up.");
    expect(dialog).toHaveTextContent("creates the Bill of Supply");
    fireEvent.click(within(dialog).getByRole("button", { name: "Out for delivery" }));
    await waitFor(() => expect(mockActions).toHaveLength(1));
    expect(mockActions[0]).toEqual({ action: "manual_advance", orderId: "o1", target: "out_for_delivery" });
  });

  test("backing out of the confirmation sends nothing", async () => {
    await openAt("packed");
    fireEvent.click(screen.getByRole("button", { name: "Picked up" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mockActions).toEqual([]);
  });

  test.each(["processed", "packed", "shipped", "out_for_delivery"])(
    "Delivered from %s opens the date dialog; any admin, reason optional",
    async (status) => {
      await openAt(status, "self");
      expect(mockRole).toBe("admin");
      fireEvent.click(screen.getByRole("button", { name: "Delivered" }));
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(
        "Use when the parcel has reached the customer. The delivery date starts the return window and cannot be changed afterwards."
      );
      expect(dialog).toHaveTextContent("Reason (optional)");
      expect(dialog).not.toHaveTextContent("Porter");
      const confirm = within(dialog).getByRole("button", { name: "Mark delivered" });
      expect(confirm).toBeEnabled();
      fireEvent.click(confirm);
      await waitFor(() => expect(mockActions).toHaveLength(1));
      expect(mockActions[0]).toMatchObject({ action: "mark_delivered", orderId: "o1", reason: "" });
      expect(typeof mockActions[0].deliveredAt).toBe("string");
    }
  );

  test("Mark delivered… never appears on a manual order, even for a superadmin", async () => {
    mockRole = "superadmin";
    await openAt("shipped");
    // Wait for the role to land: it is what would reveal the button.
    await waitFor(() => expect(screen.getByRole("button", { name: "Delivered" })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("button", { name: "Mark delivered…" })).not.toBeInTheDocument();
  });

  test.each(["processed", "packed"])("Cancel is offered at %s and sends the existing payload", async (status) => {
    await openAt(status);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Cancel reason"), { target: { value: "Customer changed mind" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel order" }));
    await waitFor(() =>
      expect(mockActions).toContainEqual({ action: "cancel", orderId: "o1", opKey: "key-1", reason: "Customer changed mind" })
    );
  });

  test.each(["shipped", "out_for_delivery", "delivered"])("Cancel is hidden at %s", async (status) => {
    await openAt(status);
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
  });

  test("Cancel stays hidden on a Shiprocket packed order", async () => {
    mockDetail = detail({ order: { status: "packed", courier: "shiprocket" } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.queryByRole("button", { name: "Cancel order" })).not.toBeInTheDocument();
  });

  test.each([
    ["porter", "Porter"],
    ["self", "Self delivery"],
  ])("Rebook is hidden for %s, whose badge reads %s", async (courier, badge) => {
    await openAt("shipped", courier);
    expect(screen.getByText(badge)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rebook/ })).not.toBeInTheDocument();
  });

  test.each([["self"], ["shiprocket"], [null]])("a shipped order with courier %s reads Picked up", async (courier) => {
    mockDetail = detail({ order: { status: "shipped", courier } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByText("Picked up")).toBeInTheDocument();
    expect(screen.queryByText("Shipped")).not.toBeInTheDocument();
  });

  test("the Shipment section names the courier from processed on, with no tracking link", async () => {
    mockDetail = manual("processed", "self", { manual_tracking_url: "https://porter.in/track/abc" });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByRole("heading", { name: "Shipment" })).toBeInTheDocument();
    expect(screen.getByText("Courier: Bindal's Creation")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /tracking link/i })).not.toBeInTheDocument();
  });

  test("a legacy shipped Porter order keeps its bill and can still advance", async () => {
    mockDetail = manual("shipped", "porter", { bill_id: 42 });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByText("Courier: Porter")).toBeInTheDocument();
    expect(screen.getByText("Bill of Supply #42")).toBeInTheDocument();
    expect(shownSteps()).toEqual(["Out for delivery", "Delivered"]);
  });

  test("a pickup order's Process is replaced by Ready for pickup, so no courier choice", async () => {
    mockDetail = detail({ order: { fulfilment: "pickup", shipping: 0, address: { name: "Asha" } } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.queryByText("Porter (manual)")).not.toBeInTheDocument();
    expect(screen.queryByText("Self delivery")).not.toBeInTheDocument();
  });
});

describe("bill PDF", () => {
  const packed = (bill) => detail({ order: { status: "packed", bill_id: 407 }, bill });
  const unsaved = { billid: 407, bill_number: "FY26-000390", pdf_url: null, finalized: true, paymentstatus: "finalized" };

  beforeEach(() => {
    mockGenerated = [];
    mockGenerateImpl = null;
    mockOpened = [];
  });

  test("a bill with no PDF gets one on its own, once, and the order links to it", async () => {
    mockDetail = packed(unsaved);
    render(<OrderDetail orderId="o1" />);
    const link = await screen.findByRole("button", { name: "Bill of Supply FY26-000390" });
    expect(mockGenerated).toEqual([407]);
    fireEvent.click(link);
    await waitFor(() => expect(mockOpened).toEqual(["bill-new.pdf"]));
  });

  test("an existing PDF is opened, not regenerated", async () => {
    mockDetail = packed({ ...unsaved, pdf_url: "bill-old.pdf" });
    render(<OrderDetail orderId="o1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Bill of Supply FY26-000390" }));
    await waitFor(() => expect(mockOpened).toEqual(["bill-old.pdf"]));
    expect(mockGenerated).toEqual([]);
  });

  test("a failure says why and Try again recovers", async () => {
    mockGenerateImpl = () => {
      throw new Error("storage down");
    };
    mockDetail = packed(unsaved);
    render(<OrderDetail orderId="o1" />);
    expect(await screen.findByText(/storage down/)).toBeInTheDocument();
    expect(mockGenerated).toEqual([407]);

    mockGenerateImpl = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Bill of Supply FY26-000390" })).toBeInTheDocument();
    expect(mockGenerated).toEqual([407, 407]);
  });

  test("a cancelled bill gets no PDF", async () => {
    mockDetail = packed({ ...unsaved, paymentstatus: "cancelled" });
    render(<OrderDetail orderId="o1" />);
    expect(await screen.findByText("Bill of Supply FY26-000390")).toBeInTheDocument();
    expect(mockGenerated).toEqual([]);
  });
});

// A <details> is found by its summary heading; no role ties the two in this testing-library version.
// eslint-disable-next-line testing-library/no-node-access
const section = (name) => screen.queryByRole("heading", { name, hidden: true })?.closest("details");

describe("page structure", () => {
  const job = { id: "j1", kind: "email_shop", status: "failed", last_error: "smtp" };
  const refund = (status) => ({ id: "r1", reason: "cancel", units: 1, total_amount: 100, status });

  test("reads header, actions, items, then the collapsed sections", async () => {
    mockDetail = detail({ order: { bill_id: 9 }, refunds: [refund("completed")] });
    render(<OrderDetail orderId="o1" />);
    const items = await screen.findByRole("heading", { name: "Items" });
    const process = processButton();
    const follows = (a, b) => expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    follows(screen.getByText("WEB-000007"), process);
    follows(process, items);
    follows(items, section("Money"));
    follows(section("Money"), section("Shipment"));
    follows(section("Shipment"), section("Refunds"));
    follows(section("Refunds"), section("Timeline"));
  });

  test("the problem box sits above the action row", async () => {
    mockDetail = detail({ order: { problem: "Parcel lost" } });
    render(<OrderDetail orderId="o1" />);
    const problem = await screen.findByText("Problem: Parcel lost");
    expect(problem.compareDocumentPosition(processButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("sections start closed, with a one-line summary", async () => {
    mockDetail = detail({ order: { bill_id: 9, courier_name: "Delhivery" }, refunds: [refund("completed")] });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    for (const name of ["Money", "Shipment", "Refunds", "Timeline"]) {
      expect(section(name)).not.toHaveAttribute("open");
    }
    expect(section("Money")).toHaveTextContent("Paid online ₹2,099.00");
    expect(section("Shipment")).toHaveTextContent("Delhivery");
    expect(section("Refunds")).toHaveTextContent("1 refund");
    expect(screen.getByRole("heading", { name: "Items" })).toBeInTheDocument();
  });

  test("a process error opens Shipment", async () => {
    mockDetail = detail({ order: { bill_id: 9, process_error: "Courier down" } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    expect(section("Shipment")).toHaveAttribute("open");
    expect(section("Timeline")).not.toHaveAttribute("open");
  });

  test("a courier error from an action opens Shipment", async () => {
    mockDetail = detail({ order: { status: "paid", bill_id: 9 }, items: [item({ id: "i1", available_qty: 1, product_name: "Kurta", paid_value: 1 })] });
    mockActionImpl = () => {
      throw Object.assign(new Error("Courier said no"), { code: "courier_error" });
    };
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    fireEvent.click(processButton());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Process" }));
    await waitFor(() => expect(section("Shipment")).toHaveAttribute("open"));
  });

  test("failed jobs open Timeline", async () => {
    mockDetail = detail({ jobs: [job] });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    expect(section("Timeline")).toHaveAttribute("open");
  });

  test.each(["awaiting_choice", "processing", "failed"])("a %s refund opens Refunds", async (status) => {
    mockDetail = detail({ refunds: [refund(status)] });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    expect(section("Refunds")).toHaveAttribute("open");
  });

  test("Shipment and Refunds stay hidden when empty", async () => {
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("WEB-000007");
    expect(section("Shipment")).toBeFalsy();
    expect(section("Refunds")).toBeFalsy();
  });

  test("an order that cannot be loaded says so instead of loading forever", async () => {
    mockGetOrderError = new Error("no such order");
    render(<OrderDetail orderId="nope" />);
    expect(await screen.findByText("Could not load this order.")).toBeInTheDocument();
    expect(mockToasts).toEqual([["error", "Could not load order", "no such order"]]);
  });
});
