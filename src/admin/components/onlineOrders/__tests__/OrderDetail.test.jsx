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
  mockRole = "admin";
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
      deliveredAt: new Date("2026-10-20T10:00").toISOString(),
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
    const d = new Date("2099-01-01T10:02:00Z");
    const pad = (n) => String(n).padStart(2, "0");
    expect(input).toHaveAttribute(
      "min",
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
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

describe("Porter (manual)", () => {
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

  test("Process defaults to Shiprocket; Porter needs a valid link if one is given, then sends dispatch_manual", async () => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    expect(within(dialog).getByRole("radio", { name: "Shiprocket" })).toBeChecked();
    expect(within(dialog).queryByLabelText("Porter tracking link")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Process" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("radio", { name: "Porter (manual)" }));
    expect(dialog).toHaveTextContent("Book the delivery in the Porter app first.");
    // same refund preview as Process: the missing Dupatta is refunded
    expect(within(dialog).getByTestId("refund-total")).toHaveTextContent("₹800.00");
    const dispatched = within(dialog).getByRole("button", { name: "Dispatched" });
    expect(dispatched).toBeEnabled(); // the link is optional
    fireEvent.change(within(dialog).getByLabelText("Porter tracking link"), { target: { value: "porter.in/x" } });
    expect(dispatched).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Porter tracking link"), {
      target: { value: " https://porter.in/track/abc " },
    });
    fireEvent.click(dispatched);
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order dispatched with Porter"]));
    expect(mockActions).toEqual([{ action: "dispatch_manual", orderId: "o1", trackingUrl: "https://porter.in/track/abc" }]);
  });

  test("Porter without a link sends trackingUrl null; nothing available → Cancel and refund", async () => {
    mockDetail = detail({ items: [item({ id: "i1", line_no: 1, product_name: "Kurta", paid_value: 1200, available_qty: 0 })] });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Porter (manual)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel and refund" }));
    await waitFor(() => expect(mockToasts).toContainEqual(["success", "Order cancelled and refunded"]));
    expect(mockActions).toEqual([{ action: "dispatch_manual", orderId: "o1", trackingUrl: null }]);
  });

  test("closing the dialog resets the choice to Shiprocket", async () => {
    mockDetail = detail({ items: checkedItems() });
    const dialog = await openProcess();
    fireEvent.click(within(dialog).getByRole("radio", { name: "Porter (manual)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    fireEvent.click(processButton());
    expect(within(await screen.findByRole("dialog")).getByRole("radio", { name: "Shiprocket" })).toBeChecked();
  });

  test("shipped Porter order: badge, link, no Rebook; any admin marks it delivered without a reason", async () => {
    mockDetail = detail({
      order: {
        status: "shipped",
        courier: "porter",
        courier_name: "Porter",
        manual_tracking_url: "https://porter.in/track/abc",
        bill_id: 42,
        delivered_at: null,
      },
    });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.getByText("Porter")).toBeInTheDocument();
    expect(screen.getByText("Courier: Porter")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Porter tracking link" })).toHaveAttribute("href", "https://porter.in/track/abc");
    expect(screen.queryByRole("button", { name: "Rebook…" })).not.toBeInTheDocument();
    expect(mockRole).toBe("admin");

    fireEvent.click(await screen.findByRole("button", { name: "Mark delivered…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Reason (optional)");
    const confirm = within(dialog).getByRole("button", { name: "Mark delivered" });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(mockActions).toHaveLength(1));
    expect(mockActions[0]).toMatchObject({ action: "mark_delivered", orderId: "o1", reason: "" });
    expect(typeof mockActions[0].deliveredAt).toBe("string");
  });

  test("a pickup order's Process is replaced by Ready for pickup, so no Porter choice", async () => {
    mockDetail = detail({ order: { fulfilment: "pickup", shipping: 0, address: { name: "Asha" } } });
    render(<OrderDetail orderId="o1" />);
    await screen.findByText("Kurta");
    expect(screen.queryByRole("button", { name: "Process" })).not.toBeInTheDocument();
    expect(screen.queryByText("Porter (manual)")).not.toBeInTheDocument();
  });
});
