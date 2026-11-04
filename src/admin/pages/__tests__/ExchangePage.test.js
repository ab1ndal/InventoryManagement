import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ExchangePage from "../ExchangePage";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({ useNavigate: () => mockNavigate }));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), info: jest.fn() },
}));
jest.mock("../../components/billing/generateInvoicePdf", () => ({
  generateInvoicePdf: jest.fn(async () => new Blob(["pdf"])),
}));
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));
const mockActivity = [];
jest.mock("../../../lib/activityLog", () => ({ logActivity: (entry) => mockActivity.push(entry) }));

const { supabase } = require("../../../lib/supabaseClient");
const { toast } = require("sonner");

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

let mockBill;
let mockOrder; // orders row linked to the bill, or null for an in-store bill
let mockTables;

// Chainable PostgREST-style builder: every filter returns itself; awaiting it,
// .single() or .maybeSingle() resolves to the table's canned result.
function builder(table) {
  const b = {};
  for (const m of ["select", "eq", "in", "ilike", "or", "order", "limit", "range", "update", "insert"]) {
    b[m] = jest.fn(() => b);
  }
  const result = () => mockTables[table] || { data: [], error: null };
  b.single = () => Promise.resolve(result());
  b.maybeSingle = () => Promise.resolve(result());
  b.then = (res, rej) => Promise.resolve(result()).then(res, rej);
  return b;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActivity.length = 0;
  window.open = jest.fn();
  URL.createObjectURL = jest.fn(() => "blob:x");
  mockBill = {
    billid: 501, bill_number: "FY26-000501", orderdate: daysAgo(1), customerid: 7, totalamount: 1000,
    customers: { first_name: "Asha", last_name: "K" },
  };
  mockOrder = null;
  mockTables = {
    bills: { data: [mockBill], error: null },
    exchanges: { data: [], error: null, count: 0 },
    bill_items: {
      data: [{
        bill_item_id: 9001, billid: 501, product_name: "Silk Kurta", product_code: "BC25001",
        category: "Kurti", quantity: 1, mrp: 1000, discount_total: 0, alteration_charge: 0,
        stitch_type: "unstitched", total: 1000, variantid: "v-1",
      }],
      error: null,
    },
    productsizecolors: { data: [{ variantid: "v-1", size: "M", color: "Red" }], error: null },
  };
  supabase.from.mockImplementation((table) => {
    if (table === "orders") mockTables.orders = { data: mockOrder, error: null };
    return builder(table);
  });
  supabase.rpc.mockResolvedValue({ data: [77], error: null });
});

async function loadBill() {
  render(<ExchangePage />);
  fireEvent.change(screen.getByPlaceholderText(/Bill number/), { target: { value: "FY26-000501" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.click(await screen.findByRole("button", { name: /#FY26-000501/ }));
}

test("nine-day-old online bill delivered three days ago loads", async () => {
  mockBill.orderdate = daysAgo(9);
  mockOrder = { delivered_at: daysAgo(3) };
  await loadBill();
  expect(await screen.findByText(/Return items from Bill #FY26-000501/)).toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
});

test("old in-store bill stays closed until the admin actively allows it", async () => {
  mockBill.orderdate = daysAgo(400);
  await loadBill();

  expect(await screen.findByText(/is 400 days old/)).toBeInTheDocument();
  expect(screen.queryByText(/Return items from Bill/)).not.toBeInTheDocument();
  expect(supabase.from).not.toHaveBeenCalledWith("bill_items");
  expect(mockActivity).toEqual([]);

  fireEvent.click(screen.getByRole("button", { name: "Allow Exchange" }));

  expect(await screen.findByText(/Return items from Bill #FY26-000501/)).toBeInTheDocument();
  expect(mockActivity).toHaveLength(1);
  expect(mockActivity[0].summary).toMatch(/FY26-000501.*400 days old/);
});

test("cancelling the warning leaves the bill unloaded and logs nothing", async () => {
  mockBill.orderdate = daysAgo(9);
  await loadBill();

  fireEvent.click(await screen.findByRole("button", { name: "Keep Closed" }));

  await waitFor(() => expect(screen.queryByRole("button", { name: "Allow Exchange" })).not.toBeInTheDocument());
  expect(screen.queryByText(/Return items from Bill/)).not.toBeInTheDocument();
  expect(supabase.from).not.toHaveBeenCalledWith("bill_items");
  expect(mockActivity).toEqual([]);
});

test("bill exactly at the window limit loads without a warning", async () => {
  mockBill.orderdate = daysAgo(7);
  await loadBill();
  expect(await screen.findByText(/Return items from Bill #FY26-000501/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Allow Exchange" })).not.toBeInTheDocument();
});

test("online bill not yet delivered is refused with no way to allow it", async () => {
  mockOrder = { delivered_at: null };
  await loadBill();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Exchange window closed", {
    description: "This online order hasn't been delivered yet.",
  }));
  expect(screen.queryByRole("button", { name: "Allow Exchange" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Return items from Bill/)).not.toBeInTheDocument();
  expect(supabase.rpc).not.toHaveBeenCalled();
});

test("delivered online bill past the window can be allowed, counted from delivery", async () => {
  mockBill.orderdate = daysAgo(20);
  mockOrder = { delivered_at: daysAgo(10) };
  await loadBill();
  expect(await screen.findByText(/was delivered 10 days ago/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Allow Exchange" }));
  expect(await screen.findByText(/Return items from Bill #FY26-000501/)).toBeInTheDocument();
});

async function confirmExchange() {
  await loadBill();
  await screen.findByText(/Return items from Bill #FY26-000501/);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review & Confirm" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Exchange" }));
}

test("a completed exchange is logged with the bill number, item count and credit, and no customer details", async () => {
  await confirmExchange();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

  expect(mockActivity).toHaveLength(1);
  expect(mockActivity[0]).toMatchObject({ action: "create", entityType: "bill", entityId: "FY26-000501" });
  expect(mockActivity[0].summary).toBe("Exchange recorded on bill #FY26-000501 — 1 item, ₹1000.00 credit");
  expect(mockActivity[0].summary).not.toMatch(/Asha/);
});

test("a failed exchange is not logged", async () => {
  supabase.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
  await confirmExchange();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Exchange failed", expect.anything()));
  expect(mockActivity).toEqual([]);
  expect(mockNavigate).not.toHaveBeenCalled();
});

test("a past-window exchange that is allowed and completed gets one entry for each step", async () => {
  mockBill.orderdate = daysAgo(400);
  await loadBill();
  fireEvent.click(await screen.findByRole("button", { name: "Allow Exchange" }));
  await screen.findByText(/Return items from Bill #FY26-000501/);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Review & Confirm" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Exchange" }));
  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());

  expect(mockActivity).toHaveLength(2);
  expect(mockActivity[0].summary).toMatch(/outside the/);
  expect(mockActivity[1].summary).toMatch(/^Exchange recorded/);
});

test("confirm calls exchange_record once and links the returned ids", async () => {
  await loadBill();
  await screen.findByText(/Return items from Bill #FY26-000501/);
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "1" } });
  fireEvent.change(screen.getByPlaceholderText("e.g., size mismatch"), { target: { value: " size " } });
  fireEvent.click(screen.getByRole("button", { name: "Review & Confirm" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Exchange" }));

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  expect(supabase.rpc).toHaveBeenCalledTimes(1);
  expect(supabase.rpc).toHaveBeenCalledWith("exchange_record", {
    p_billid: 501,
    p_customerid: 7,
    p_items: [{
      bill_item_id: 9001, quantity: 1, credit_amount: 1000, reason: "size",
      product_name: "Silk Kurta", product_code: "BC25001", variantid: "v-1", manual_item_id: null,
    }],
  });
  expect(supabase.from).not.toHaveBeenCalledWith("manual_items");
  expect(mockNavigate.mock.calls[0][1].state.exchangeCredit.exchangeIds).toEqual([77]);
});
