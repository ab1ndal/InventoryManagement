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
  supabase: { auth: { getUser: jest.fn() }, from: jest.fn(), rpc: jest.fn() },
}));

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
  window.open = jest.fn();
  URL.createObjectURL = jest.fn(() => "blob:x");
  mockBill = {
    billid: 501, bill_number: "FY26-000501", orderdate: daysAgo(1), customerid: 7, totalamount: 1000,
    customers: { first_name: "Asha", last_name: "K" },
  };
  mockOrder = null;
  mockTables = {
    profiles: { data: { role: "admin" }, error: null },
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
  supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u-admin" } } });
  supabase.from.mockImplementation((table) => {
    if (table === "orders") mockTables.orders = { data: mockOrder, error: null };
    return builder(table);
  });
  supabase.rpc.mockResolvedValue({ data: [77], error: null });
});

async function loadBill() {
  render(<ExchangePage />);
  // role must be loaded before the window check reads it
  await waitFor(() => expect(supabase.from).toHaveBeenCalledWith("profiles"));
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

test("nine-day-old in-store bill is outside the window", async () => {
  mockBill.orderdate = daysAgo(9);
  await loadBill();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Exchange window closed", expect.anything()));
  expect(screen.queryByText(/Return items from Bill/)).not.toBeInTheDocument();
});

test("online bill not yet delivered is outside the window", async () => {
  mockOrder = { delivered_at: null };
  await loadBill();
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Exchange window closed", {
    description: "This online order hasn't been delivered yet.",
  }));
  expect(screen.queryByText(/Return items from Bill/)).not.toBeInTheDocument();
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
