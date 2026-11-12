import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillTable from "../BillTable";

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockBillQueries = [];

const mockBillQuery = () => {
  const q = { from: 0, statusIn: null };
  mockBillQueries.push(q);
  const chain = {
    select: () => chain,
    order: () => chain,
    eq: () => chain,
    range: (from) => {
      q.from = from;
      return chain;
    },
    in: (col, values) => {
      if (col === "paymentstatus") q.statusIn = values;
      return chain;
    },
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: () => mockBillQuery() },
}));

beforeEach(() => {
  mockBillQueries = [];
});

const openStatusMenu = () => fireEvent.click(screen.getByRole("button", { name: /status: all/i }));

test("no status ticked lists every status", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("No bills found");
  expect(mockBillQueries.at(-1).statusIn).toBeNull();
});

test("ticking several statuses filters to all of them and starts at page 1", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("No bills found");
  openStatusMenu();

  fireEvent.click(screen.getByLabelText("Draft"));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toEqual(["draft"]));

  fireEvent.click(screen.getByLabelText("Pending Payment"));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toEqual(["draft", "partial"]));
  expect(mockBillQueries.at(-1).from).toBe(0);
  expect(screen.getByRole("button", { name: /status: draft, pending payment/i })).toBeInTheDocument();
});

test("unticking the last status and Clear both go back to all", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("No bills found");
  openStatusMenu();

  fireEvent.click(screen.getByLabelText("Cancelled"));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toEqual(["cancelled"]));
  fireEvent.click(screen.getByLabelText("Cancelled"));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toBeNull());

  fireEvent.click(screen.getByLabelText("Finalized"));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toEqual(["finalized"]));
  fireEvent.click(screen.getByRole("button", { name: /clear/i }));
  await waitFor(() => expect(mockBillQueries.at(-1).statusIn).toBeNull());
});
