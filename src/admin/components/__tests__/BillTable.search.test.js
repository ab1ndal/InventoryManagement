import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import BillTable from "../BillTable";

const mockRow = (billid) => ({
  billid,
  bill_number: `FY26-${String(billid).padStart(6, "0")}`,
  document_type: "bos",
  customers: null,
  orderdate: "2026-10-01",
  totalamount: 1000,
  gst_total: 0,
  discount_total: 0,
  paymentstatus: "finalized",
  finalized: true,
  pdf_url: null,
});

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockBillQueries = [];

const mockBillQuery = () => {
  const q = { from: 0, or: null };
  mockBillQueries.push(q);
  const chain = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    range: (from) => {
      q.from = from;
      return chain;
    },
    or: (expr) => {
      q.or = expr;
      return chain;
    },
    then: (resolve) => {
      // 51 rows on the first page exposes "Next"; a search matches only first-page rows.
      const data = q.or
        ? q.from === 0 ? [mockRow(1)] : []
        : Array.from({ length: 51 }, (_, i) => mockRow(i + 1 + q.from));
      return resolve({ data, error: null });
    },
  };
  return chain;
};

const mockSimpleQuery = () => {
  const chain = {
    select: () => chain,
    or: () => chain,
    ilike: () => chain,
    in: () => chain,
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => (table === "bills" ? mockBillQuery() : mockSimpleQuery()),
  },
}));

beforeEach(() => {
  mockBillQueries = [];
});

test("a search from page 2 returns to page 1 and finds first-page matches", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000001");

  fireEvent.click(screen.getByRole("button", { name: /next/i }));
  await waitFor(() => expect(mockBillQueries.at(-1).from).toBe(50));
  await screen.findByText("FY26-000051");

  fireEvent.change(screen.getByPlaceholderText(/Search by bill/), {
    target: { value: "000001" },
  });

  expect(await screen.findByText("FY26-000001")).toBeInTheDocument();
  expect(mockBillQueries.at(-1)).toMatchObject({ from: 0 });
  expect(screen.queryByText("No bills found")).not.toBeInTheDocument();
});

test("fast typing sends one search, not one per keystroke", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000001");
  const before = mockBillQueries.length;

  const box = screen.getByPlaceholderText(/Search by bill/);
  for (const value of ["0", "00", "000", "0000"]) {
    fireEvent.change(box, { target: { value } });
  }
  await waitFor(() => expect(mockBillQueries.length).toBe(before + 1));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
  expect(mockBillQueries.length).toBe(before + 1);
  expect(mockBillQueries.at(-1).or).toContain("0000");
});
