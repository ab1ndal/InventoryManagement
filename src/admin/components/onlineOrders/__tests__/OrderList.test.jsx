import { render, screen, fireEvent } from "@testing-library/react";
import OrderList from "../OrderList";

let mockFilters = [];
const mockRows = {
  to_check: [
    {
      id: "o1",
      order_ref: "WEB-000001",
      created_at: "2026-10-23T10:00:00Z",
      status: "paid",
      contact_name: "Asha",
      contact_phone: "+919999999999",
      subtotal: 2000,
      promo_discount: 0,
      shipping: 99,
      voucher_applied: 0,
      credit_applied: 100,
      gateway_amount: 1999,
      problem: null,
      process_error: null,
      order_items: [{ qty: 2 }, { qty: 1 }],
    },
  ],
  all: [
    {
      id: "o3",
      order_ref: "WEB-000003",
      created_at: "2026-10-21T10:00:00Z",
      status: "delivered",
      contact_name: "Meera",
      contact_phone: "+917777777777",
      subtotal: 900,
      promo_discount: 0,
      shipping: 0,
      voucher_applied: 0,
      credit_applied: 0,
      gateway_amount: 900,
      problem: null,
      process_error: null,
      order_items: [{ qty: 2, shipped_qty: 2 }],
      returns: [{ status: "refunded", items: [{ received_units: 1 }] }],
    },
  ],
  problems: [
    {
      id: "o2",
      order_ref: "WEB-000002",
      created_at: "2026-10-22T10:00:00Z",
      status: "rto",
      contact_name: "Ravi",
      contact_phone: "+918888888888",
      subtotal: 500,
      promo_discount: 0,
      shipping: 0,
      voucher_applied: 0,
      credit_applied: 0,
      gateway_amount: 500,
      problem: null,
      process_error: null,
      order_items: [{ qty: 1 }],
    },
  ],
};

jest.mock("../onlineOrdersApi", () => ({
  ORDER_FILTERS: {
    to_check: { label: "To check", statuses: ["paid"] },
    processing: { label: "Processing" },
    packed: { label: "Packed" },
    shipped: { label: "Shipped" },
    delivered: { label: "Delivered" },
    problems: { label: "Problems" },
    all: { label: "All" },
  },
  listOrders: async (f) => {
    mockFilters.push(f);
    return mockRows[f] || [];
  },
}));
jest.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));


beforeEach(() => {
  mockFilters = [];
});

test("opens on To check and shows ref, item count, total paid and status", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  expect(await screen.findByText("WEB-000001")).toBeInTheDocument();
  expect(mockFilters).toEqual(["to_check"]);
  const row = screen.getByRole("row", { name: /WEB-000001/ });
  expect(row).toHaveTextContent("3"); // 2 + 1 items
  expect(row).toHaveTextContent("₹2,099.00"); // online + credit
  expect(row).toHaveTextContent("To check");
});

test("switching tab reloads with that filter and flags problems", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await screen.findByText("WEB-000001");
  fireEvent.click(screen.getByRole("tab", { name: "Problems" }));
  expect(await screen.findByText("WEB-000002")).toBeInTheDocument();
  expect(mockFilters).toEqual(["to_check", "problems"]);
  expect(screen.getByLabelText("Needs attention")).toBeInTheDocument();
  expect(screen.queryByText("WEB-000001")).not.toBeInTheDocument();
});

test("empty tab says so", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await screen.findByText("WEB-000001");
  fireEvent.click(screen.getByRole("tab", { name: "Delivered" }));
  expect(await screen.findByText("No orders here.")).toBeInTheDocument();
});

test("clicking a row selects the order", async () => {
  const picked = [];
  render(<OrderList onSelect={(id) => picked.push(id)} refreshKey={0} />);
  fireEvent.click(await screen.findByText("WEB-000001"));
  expect(picked).toEqual(["o1"]);
});

test("shows a returns badge on a partly returned order", async () => {
  render(<OrderList onSelect={() => {}} refreshKey={0} />);
  await screen.findByText("WEB-000001");
  fireEvent.click(screen.getByRole("tab", { name: "All" }));
  const row = await screen.findByRole("row", { name: /WEB-000003/ });
  expect(row).toHaveTextContent("Partly returned");
});
