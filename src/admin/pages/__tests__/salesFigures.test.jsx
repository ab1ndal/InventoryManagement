import { render, screen } from "@testing-library/react";
import DashboardPage from "../DashboardPage";
import { MonthlySales } from "../AdminPage";

// A real server refuses a request listing more than about 640 ids.
const URL_LIMIT = 640;
const mockVariants = Array.from({ length: 700 }, (_, i) => `variant-${i}`);
const mockDb = { costLookups: [], failCosts: false };

const mockChain = (table) => {
  let listed = null;
  const reply = (from = 0) => {
    if (table === "bills") {
      return { data: [{ billid: 1, net_amount: 7000, orderdate: "2026-06-01" }], error: null };
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
    eq: () => chain,
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

  expect(await screen.findByText("Costs 1400")).toBeInTheDocument();
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

  // 7000 of sales less 700 products at 2 each.
  expect(await screen.findByText(/5,600/)).toBeInTheDocument();
  expect(mockDb.costLookups).toEqual([300, 300, 100]);
});

test("Monthly Sales says so when its figures fail, instead of showing no sales", async () => {
  mockDb.failCosts = true;
  render(<MonthlySales />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Figures did not load");
  expect(screen.queryByText("No sales data found.")).not.toBeInTheDocument();
});
