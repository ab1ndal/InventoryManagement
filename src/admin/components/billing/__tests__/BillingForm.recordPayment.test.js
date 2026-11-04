import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

const mockToasts = [];

jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: () => {},
    warning: () => {},
  },
}));

let mockBill;

const mockChain = (table) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: table === "bills" ? mockBill : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

// As stored on FY26-000313: an agreed final amount, so the stored total differs from what the items
// add up to before that adjustment.
const partialBill = {
  orderdate: "2026-09-30T00:00:00",
  customerid: null,
  customers: null,
  paymentstatus: "partial",
  finalized: true,
  totalamount: 800,
  net_amount: 800,
  final_amount: 800,
  payment_amount: 300,
  discount_total: 190,
  applied_codes: [],
  bill_payments: [{ payment_id: 1, amount: 300, recorded_at: "2026-09-30T12:00:00" }],
  bill_salespersons: [],
  linked_exchanges: [],
  document_type: "bos",
  bill_items: [
    {
      bill_item_id: 11,
      product_name: "Kurti",
      quantity: 1,
      mrp: 990,
      discount_total: 190,
      total: 800,
      stitch_type: "unstitched",
    },
  ],
};

const record = () => screen.getByRole("button", { name: "Record" });

beforeEach(() => {
  mockToasts.length = 0;
  mockBill = partialBill;
  clearBillingLookups();
});

test("recording a payment on an unchanged bill does not ask to resave it", async () => {
  // The stored total is deliberately not what the items add up to today.
  mockBill = { ...partialBill, totalamount: 777.77 };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  fireEvent.click(record());

  expect(mockToasts).toEqual(["Enter a valid amount"]);
});

test("recording a payment after a real item edit still asks to save first", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Remove Kurti" }));
  fireEvent.click(record());

  expect(mockToasts).toEqual(["Unsaved item changes"]);
});
