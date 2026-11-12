import { render, screen } from "@testing-library/react";
import DashboardPage from "../DashboardPage";
import { MonthlySales } from "../AdminPage";

// A real server refuses a request listing more than about 640 ids.
const URL_LIMIT = 640;
const mockVariants = Array.from({ length: 700 }, (_, i) => `variant-${i}`);
const mockDb = { costLookups: [], failCosts: false };

// A live sale, a draft, a cancelled finalized bill and an old bill with no status. Only the
// live sale and the old bill are sales; the filters below run as PostgREST would run them.
const mockBills = [
  { billid: 1, net_amount: 7000, orderdate: "2026-06-11", finalized: true, paymentstatus: "finalized" },
  { billid: 2, net_amount: 500, orderdate: "2026-06-12", finalized: false, paymentstatus: "draft" },
  { billid: 3, net_amount: 900, orderdate: "2026-06-13", finalized: true, paymentstatus: "cancelled" },
  { billid: 4, net_amount: 60, orderdate: "2026-06-14", finalized: true, paymentstatus: null },
];
const sqlEq = (a, b) => (a == null || b == null ? null : String(a) === String(b));
const orTerm = (part) => {
  const [col, op, val] = part.split(".");
  return (row) =>
    op === "is" ? row[col] == null
    : op === "neq" ? sqlEq(row[col], val) === false
    : sqlEq(row[col], val) === true;
};

const mockChain = (table) => {
  let listed = null;
  const filters = [];
  const reply = (from = 0) => {
    if (table === "bills") {
      return { data: mockBills.filter((b) => filters.every((f) => f(b))), error: null };
    }
    if (table === "bill_items") {
      return {
        data: from > 0 ? [] : mockVariants.map((variantid) => ({ billid: 1, product_code: "BC26001", variantid, quantity: 1 })),
        error: null,
      };
    }
    if (table === "variant_costs") {
      mockDb.costLookups.push(listed.length);
      if (mockDb.failCosts || listed.length > URL_LIMIT) return { data: null, error: { message: "400 Bad Request" } };
      return { data: listed.map((variantid) => ({ variantid, purchaseprice: 2 })), error: null };
    }
    return { data: [], error: null };
  };
  let rangeFrom = 0;
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      filters.push((row) => sqlEq(row[col], val) === true);
      return chain;
    },
    or: (expr) => {
      const terms = expr.split(",").map(orTerm);
      filters.push((row) => terms.some((t) => t(row)));
      return chain;
    },
    gte: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    in: (_col, values) => {
      listed = values;
      return chain;
    },
    range: (from) => {
      rangeFrom = from;
      return chain;
    },
    then: (res, rej) => Promise.resolve(reply(rangeFrom)).then(res, rej),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: (table) => mockChain(table) },
}));

jest.mock("sonner", () => ({ toast: { error: () => {} } }));

// Only the figures matter here, not the charts and tables that draw them.
jest.mock("../../components/dashboard/KpiCards", () => ({ current, loading }) => (
  <div>
    {!loading && `Costs ${current.items.reduce((sum, item) => sum + item.cost_price, 0)}`}
    {!loading && ` Sales ${current.bills.reduce((sum, bill) => sum + bill.net_amount, 0)}`}
  </div>
));
jest.mock("../../components/dashboard/RevenueChart", () => () => null);
jest.mock("../../components/dashboard/CategoryBreakdown", () => () => null);
jest.mock("../../components/dashboard/SalespersonTable", () => () => null);
jest.mock("../../components/dashboard/DiscountTable", () => () => null);
jest.mock("../../components/dashboard/HistoricalTrends", () => () => null);
jest.mock("../../components/dashboard/DashboardFilters", () => () => null);
jest.mock("../CategoriesPage", () => () => null);
jest.mock("../SalespersonsPage", () => () => null);
jest.mock("../../components/attributes/AttributesTab", () => () => null);
jest.mock("../../components/AdminInvites", () => () => null);

beforeEach(() => {
  mockDb.costLookups = [];
  mockDb.failCosts = false;
});

test("the dashboard adds up costs for 700 products without one over-long request", async () => {
  render(<DashboardPage />);

  expect(await screen.findByText(/Costs 1400/)).toBeInTheDocument();
  expect(mockDb.costLookups).toEqual([300, 300, 100]);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("the dashboard hides its figures and says so when they fail to load", async () => {
  mockDb.failCosts = true;
  render(<DashboardPage />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Figures did not load");
  expect(screen.queryByText(/Costs/)).not.toBeInTheDocument();
});

test("Monthly Sales adds up costs for 700 products without one over-long request", async () => {
  render(<MonthlySales />);

  // 7060 of sales less 700 products at 2 each.
  expect(await screen.findByText(/5,660/)).toBeInTheDocument();
  expect(mockDb.costLookups).toEqual([300, 300, 100]);
});

test("Monthly Sales says so when its figures fail, instead of showing no sales", async () => {
  mockDb.failCosts = true;
  render(<MonthlySales />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Figures did not load");
  expect(screen.queryByText("No sales data found.")).not.toBeInTheDocument();
});

test("the dashboard counts live sales only, not drafts or cancelled bills", async () => {
  render(<DashboardPage />);

  expect(await screen.findByText(/Sales 7060/)).toBeInTheDocument();
});

test("Monthly Sales counts live sales only, not drafts or cancelled bills", async () => {
  render(<MonthlySales />);

  expect(await screen.findByText(/7,060/)).toBeInTheDocument();
  expect(screen.queryByText(/8,460/)).not.toBeInTheDocument();
});
