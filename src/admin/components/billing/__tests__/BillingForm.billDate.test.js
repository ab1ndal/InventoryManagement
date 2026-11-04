import { render, screen, waitFor, act } from "@testing-library/react";
import BillingForm from "../BillingForm";

let mockResolveBill;
let mockBillQueries;

const mockChain = (table) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => {
      if (table !== "bills") return Promise.resolve({ data: null, error: null });
      mockBillQueries += 1;
      return new Promise((resolve) => mockResolveBill.push(resolve));
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const billRow = { orderdate: "2026-09-30T00:00:00", customerid: null, paymentstatus: "draft" };

const dateInput = () => screen.getByLabelText("Bill Date");

const loadBillRows = async () => {
  await act(async () => {
    mockResolveBill.splice(0).forEach((resolve) => resolve({ data: billRow, error: null }));
  });
};

beforeEach(() => {
  mockResolveBill = [];
  mockBillQueries = 0;
});

test("an existing bill shows no date, not today, until its own date has loaded", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  expect(dateInput().value).toBe("");

  await loadBillRows();
  await waitFor(() => expect(dateInput().value).toBe("2026-09-30"));
});

test("the bill date arrives with the first bill query", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(mockBillQueries).toBe(1));

  const [resolveFirst] = mockResolveBill.splice(0);
  await act(async () => {
    resolveFirst({ data: billRow, error: null });
  });

  await waitFor(() => expect(dateInput().value).toBe("2026-09-30"));
});

test("reopening the same bill does not flash today's date", async () => {
  const { rerender } = render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await loadBillRows();
  await waitFor(() => expect(dateInput().value).toBe("2026-09-30"));

  rerender(<BillingForm billId={370} open={false} onOpenChange={() => {}} />);
  rerender(<BillingForm billId={370} open onOpenChange={() => {}} />);
  expect(dateInput().value).toBe("");

  await loadBillRows();
  await waitFor(() => expect(dateInput().value).toBe("2026-09-30"));
});

test("a new bill still starts on today", () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  expect(dateInput().value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
