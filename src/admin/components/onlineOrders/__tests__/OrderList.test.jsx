import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import OrderList, { CourierBadge, StatusBadge } from "../OrderList";

let mockQueues = [];
let mockSearches = [];
let mockToasts = [];
let mockCountsImpl = null;
let mockCountCalls = 0;
let mockEmptyQueues = false;

const order = (over) => ({
  created_at: "2026-10-23T10:00:00Z",
  fulfilment: "ship",
  courier: null,
  awb: null,
  address: { city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
  subtotal: 500,
  promo_discount: 0,
  shipping: 0,
  voucher_applied: 0,
  credit_applied: 0,
  gateway_amount: 500,
  problem: null,
  process_error: null,
  order_items: [{ qty: 1 }],
  ...over,
});

const mockRows = {
  needs_action: [
    order({
      id: "o1",
      order_ref: "WEB-000001",
      status: "paid",
      contact_name: "Asha",
      contact_phone: "+919999999999",
      credit_applied: 100,
      gateway_amount: 1999,
      order_items: [{ qty: 2 }, { qty: 1 }],
    }),
    order({
      id: "o2",
      order_ref: "WEB-000002",
      status: "shipped",
      courier: "shiprocket",
      contact_name: "Ravi",
      contact_phone: "+918888888888",
      process_error: "Courier down",
    }),
    order({
      id: "o6",
      order_ref: "WEB-000006",
      status: "delivered",
      courier: "porter",
      contact_name: "Lata",
      contact_phone: "+914444444444",
      order_items: [{ qty: 1, shipped_qty: 1 }],
      returns: [{ status: "open", items: [{ received_units: 0 }] }],
    }),
  ],
  in_progress: [
    order({
      id: "o5",
      order_ref: "WEB-000005",
      status: "shipped",
      courier: "porter",
      contact_name: "Ravi",
      contact_phone: "+915555555555",
    }),
    order({
      id: "o4",
      order_ref: "WEB-000004",
      status: "ready_for_pickup",
      fulfilment: "pickup",
      contact_name: "Nita",
      address: { name: "Nita", phone: "+916666666666" },
      contact_phone: "+916666666666",
    }),
  ],
  closed: [
    order({
      id: "o3",
      order_ref: "WEB-000003",
      status: "delivered",
      awb: "AWB1",
      contact_name: "Meera",
      address: { city: "Mumbai", state: "Maharashtra", pincode: "400001" },
      contact_phone: "+917777777777",
      order_items: [{ qty: 2, shipped_qty: 2 }],
      returns: [{ status: "refunded", items: [{ received_units: 1 }] }],
    }),
  ],
};

const mockSearchRow = order({
  id: "o9",
  order_ref: "WEB-000009",
  status: "expired",
  contact_name: "Found",
  contact_phone: "+911111111111",
});

jest.mock("../onlineOrdersApi", () => ({
  DEFAULT_QUEUE: "needs_action",
  ORDER_QUEUES: {
    needs_action: { label: "Needs action", counted: true },
    in_progress: { label: "In progress", counted: true },
    closed: { label: "Closed" },
  },
  listOrders: async (q) => {
    mockQueues.push(q);
    return mockEmptyQueues ? [] : mockRows[q];
  },
  searchOrders: async (t) => {
    mockSearches.push(t);
    return t === "nothing" ? [] : [mockSearchRow];
  },
  countOrders: async () => {
    mockCountCalls += 1;
    return mockCountsImpl ? mockCountsImpl() : { needs_action: 3, in_progress: 2 };
  },
}));
jest.mock("sonner", () => ({
  toast: { error: (m, o) => mockToasts.push([m, o?.description]), success: () => {} },
}));

beforeEach(() => {
  mockQueues = [];
  mockSearches = [];
  mockToasts = [];
  mockCountsImpl = null;
  mockCountCalls = 0;
  mockEmptyQueues = false;
});

const row = (name) => screen.findByRole("button", { name });
const search = (value) => fireEvent.change(screen.getByRole("searchbox", { name: "Search orders" }), { target: { value } });

test("opens on Needs action with ref, name, total, item count and next step", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  const r = await row(/WEB-000001/);
  expect(mockQueues).toEqual(["needs_action"]);
  expect(r).toHaveTextContent("Asha");
  expect(r).toHaveTextContent("₹2,099.00"); // online + credit
  expect(r).toHaveTextContent("3 items");
  expect(r).toHaveTextContent("Check shelf and process");
  expect(r).toHaveAccessibleName(expect.stringContaining("+919999999999"));
  expect(r).not.toHaveTextContent("To check");
});

test("counts show on the first two tabs only", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  expect(await screen.findByRole("tab", { name: "Needs action (3)" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "In progress (2)" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Closed" })).toBeInTheDocument();
});

test("counts and list refresh with refreshKey", async () => {
  const { rerender } = render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await screen.findByRole("tab", { name: "Needs action (3)" });
  mockCountsImpl = () => ({ needs_action: 2, in_progress: 3 });
  rerender(<OrderList onSelect={() => {}} refreshKey={1} />);
  expect(await screen.findByRole("tab", { name: "Needs action (2)" })).toBeInTheDocument();
  expect(mockCountCalls).toBe(2);
  expect(mockQueues).toEqual(["needs_action", "needs_action"]);
});

test("a count failure toasts, leaves no number and still shows the list", async () => {
  mockCountsImpl = () => {
    throw new Error("count down");
  };
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  expect(await row(/WEB-000001/)).toBeInTheDocument();
  await waitFor(() => expect(mockToasts).toEqual([["Could not count orders", "count down"]]));
  expect(screen.getByRole("tab", { name: "Needs action" })).toBeInTheDocument();
});

test("switching queue reloads with that queue", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await row(/WEB-000001/);
  fireEvent.click(screen.getByRole("tab", { name: /In progress/ }));
  expect(await row(/WEB-000005/)).toBeInTheDocument();
  expect(mockQueues).toEqual(["needs_action", "in_progress"]);
  expect(screen.queryByText("WEB-000001")).not.toBeInTheDocument();
});

test("a process error reads Needs attention with the warning icon", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  const r = await row(/WEB-000002/);
  expect(r).toHaveTextContent("Needs attention");
  expect(r).not.toHaveTextContent("With courier");
  expect(within(r).getByText("Needs attention")).toHaveClass("text-red-700");
  // eslint-disable-next-line testing-library/no-node-access
  expect(within(r).getByText("Needs attention").querySelector("svg")).toBeInTheDocument();
});

test("an order with an open return says so and falls back to its status", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  const r = await row(/WEB-000006/);
  expect(r).toHaveTextContent("Return open");
  expect(r).toHaveTextContent("Delivered");
});

test("rows carry one delivery label and no status badge while a step is left", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await row(/WEB-000001/);
  fireEvent.click(screen.getByRole("tab", { name: /In progress/ }));
  const porter = await row(/WEB-000005/);
  expect(porter).toHaveTextContent("1 item · Porter");
  expect(porter).toHaveTextContent("Mark out for delivery");
  expect(porter).not.toHaveTextContent("Picked up");
  const pickup = await row(/WEB-000004/);
  expect(pickup).toHaveTextContent("1 item · Pickup");
  expect(pickup).toHaveTextContent("Waiting for customer");
  expect(pickup).not.toHaveTextContent("Store pickup");
  expect(pickup).not.toHaveTextContent("Outside UP");
});

test("closed rows show exception badges and the status label", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  const up = await row(/WEB-000001/);
  expect(up).not.toHaveTextContent("Outside UP");
  fireEvent.click(screen.getByRole("tab", { name: "Closed" }));
  const r = await row(/WEB-000003/);
  expect(r).toHaveTextContent("2 items · Shiprocket");
  expect(r).toHaveTextContent("Outside UP");
  expect(r).toHaveTextContent("Partly returned");
  expect(r).toHaveTextContent("Delivered");
});

test("an undecided order has no delivery label", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  const r = await row(/WEB-000001/);
  expect(r).not.toHaveTextContent("·");
});

test("clicking a row selects the order and the selected row is marked", async () => {
  const picked = [];
  render(<OrderList selectedId="o2" onSelect={(id) => picked.push(id)} refreshKey={0} />);
  fireEvent.click(await row(/WEB-000001/));
  expect(picked).toEqual(["o1"]);
  const selected = await row(/WEB-000002/);
  expect(selected).toHaveAttribute("aria-current", "true");
  expect(selected).toHaveClass("bg-blue-50");
  expect(await row(/WEB-000001/)).not.toHaveAttribute("aria-current");
});

test("empty queue says so", async () => {
  mockEmptyQueues = true;
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  expect(await screen.findByText("No orders here.")).toBeInTheDocument();
});

describe("search", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flush = () => act(async () => {});
  const advance = (ms) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  test("waits 300ms, replaces the queue, and clearing returns to it", async () => {
    render(<OrderList onSelect={() => {}} refreshKey={0} />);
    await flush();
    search(" WEB ");
    await advance(299);
    expect(mockSearches).toEqual([]);
    await advance(1);
    expect(mockSearches).toEqual(["WEB"]);
    expect(screen.getByRole("button", { name: /WEB-000009/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /WEB-000001/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Needs action/ })).toHaveAttribute("aria-selected", "false");

    search("");
    await flush();
    expect(screen.getByRole("button", { name: /WEB-000001/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Needs action/ })).toHaveAttribute("aria-selected", "true");
  });

  test("only the last of quick keystrokes searches", async () => {
    render(<OrderList onSelect={() => {}} refreshKey={0} />);
    await flush();
    search("A");
    await advance(100);
    search("As");
    await advance(300);
    expect(mockSearches).toEqual(["As"]);
  });

  test("blank spaces are no search", async () => {
    render(<OrderList onSelect={() => {}} refreshKey={0} />);
    await flush();
    search("   ");
    await advance(300);
    expect(mockSearches).toEqual([]);
    expect(screen.getByRole("button", { name: /WEB-000001/ })).toBeInTheDocument();
  });

  test("no result says so", async () => {
    render(<OrderList onSelect={() => {}} refreshKey={0} />);
    await flush();
    search("nothing");
    await advance(300);
    expect(screen.getByText("No orders here.")).toBeInTheDocument();
  });

  test("choosing a queue clears the search", async () => {
    render(<OrderList onSelect={() => {}} refreshKey={0} />);
    await flush();
    search("WEB");
    await advance(300);
    fireEvent.click(screen.getByRole("tab", { name: "Closed" }));
    await flush();
    expect(screen.getByRole("searchbox", { name: "Search orders" })).toHaveValue("");
    expect(screen.getByRole("button", { name: /WEB-000003/ })).toBeInTheDocument();
  });
});

test("CourierBadge names Porter and self delivery, nothing otherwise", () => {
  const { rerender, container } = render(<CourierBadge courier="porter" />);
  expect(container).toHaveTextContent("Porter");
  rerender(<CourierBadge courier="self" />);
  expect(container).toHaveTextContent("Self delivery");
  rerender(<CourierBadge courier="shiprocket" />);
  expect(container).toBeEmptyDOMElement();
  rerender(<CourierBadge courier={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("StatusBadge: shipped reads Picked up, processed reads Processed", () => {
  const { rerender } = render(<StatusBadge status="shipped" />);
  expect(screen.getByText("Picked up")).toBeInTheDocument();
  rerender(<StatusBadge status="processed" />);
  expect(screen.getByText("Processed")).toBeInTheDocument();
});
