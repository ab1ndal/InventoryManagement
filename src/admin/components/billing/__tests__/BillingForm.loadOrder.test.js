import { render, screen, waitFor, act } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

const mockCalls = [];
let mockBill;
let mockReleaseDiscounts;

const mockChain = (table) => {
  mockCalls.push(table);
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: table === "bills" ? mockBill : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => {
      if (table === "discounts") {
        return new Promise((resolve) => {
          mockReleaseDiscounts = () =>
            resolve({ data: [{ id: 1, code: "TEN", type: "percent", value: 10 }], error: null });
        }).then(res, rej);
      }
      return Promise.resolve({ data: [], error: null }).then(res, rej);
    },
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const baseBill = {
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "", phone: "999", store_credit: 0, discount_usage: [], exchanges: [] },
  bill_items: [],
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  applied_codes: [],
  paymentstatus: "draft",
};

const count = (table) => mockCalls.filter((t) => t === table).length;
const saveDraft = () => screen.getByRole("button", { name: "Save Draft" });

beforeEach(() => {
  mockCalls.length = 0;
  mockBill = baseBill;
  clearBillingLookups();
});

test("an existing bill arrives in one bills request, with no separate customer requests", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Bill Date").value).toBe("2026-09-30"));

  expect(count("bills")).toBe(1);
  expect(count("customers")).toBe(0);
  expect(count("bill_items")).toBe(0);
  expect(count("bill_payments")).toBe(0);
  expect(count("discount_usage")).toBe(0);
  expect(count("salespersons")).toBe(1);
  expect(screen.getByDisplayValue("Asha | 999")).toBeInTheDocument();
});

test("discounts start only after the bill has loaded", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  expect(count("bills")).toBe(1);
  expect(count("discounts")).toBe(0);
  await waitFor(() => expect(count("discounts")).toBe(1));
});

test("a bill with no saved codes can be saved while discounts are still loading", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(count("discounts")).toBe(1));
  expect(saveDraft()).toBeEnabled();
});

test("a bill with saved codes cannot be saved until discounts arrive, as totals depend on them", async () => {
  mockBill = { ...baseBill, applied_codes: ["TEN"] };
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(count("discounts")).toBe(1));
  expect(saveDraft()).toBeDisabled();

  await act(async () => {
    mockReleaseDiscounts();
  });
  await waitFor(() => expect(saveDraft()).toBeEnabled());
});

test("a new bill waits for discounts, because auto-apply needs them", async () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  await waitFor(() => expect(count("discounts")).toBe(1));
  expect(saveDraft()).toBeDisabled();
  expect(count("bills")).toBe(0);

  await act(async () => {
    mockReleaseDiscounts();
  });
  await waitFor(() => expect(saveDraft()).toBeEnabled());
});

test("reopening a bill does not fetch the shared lists again", async () => {
  const { rerender } = render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(count("discounts")).toBe(1));
  await act(async () => {
    mockReleaseDiscounts();
  });

  rerender(<BillingForm billId={370} open={false} onOpenChange={() => {}} />);
  rerender(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(count("bills")).toBe(2));
  await waitFor(() => expect(screen.getByLabelText("Bill Date").value).toBe("2026-09-30"));

  expect(count("discounts")).toBe(1);
  expect(count("salespersons")).toBe(1);
  expect(count("saleslocations")).toBe(1);
});
