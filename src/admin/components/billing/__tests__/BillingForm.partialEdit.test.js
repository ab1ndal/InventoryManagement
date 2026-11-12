import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

jest.mock("sonner", () => ({
  toast: { error: () => {}, success: () => {}, warning: () => {} },
}));

let mockBill;
const mockBillUpdates = [];

const mockChain = (table) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    delete: () => chain,
    insert: () => chain,
    update: (payload) => {
      if (table === "bills") mockBillUpdates.push(payload);
      return chain;
    },
    single: () => Promise.resolve({ data: table === "bills" ? mockBill : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const item = (id, name, total) => ({
  bill_item_id: id,
  product_name: name,
  quantity: 1,
  mrp: total,
  discount_total: 0,
  total,
  stitch_type: "unstitched",
});

// Two unstocked lines (no variantid) so saving touches no stock.
const partialBill = {
  orderdate: "2026-09-30T00:00:00",
  customerid: null,
  customers: null,
  paymentstatus: "partial",
  finalized: true,
  stock_reduced: false,
  totalamount: 800,
  net_amount: 800,
  final_amount: null,
  payment_amount: 300,
  discount_total: 0,
  applied_codes: [],
  bill_payments: [{ payment_id: 1, amount: 300, recorded_at: "2026-09-30T12:00:00" }],
  bill_salespersons: [],
  linked_exchanges: [],
  document_type: "bos",
  bill_items: [item(11, "Kurti", 300), item(12, "Dupatta", 500)],
};

beforeEach(() => {
  mockBill = partialBill;
  mockBillUpdates.length = 0;
  clearBillingLookups();
});

const saveChanges = () => screen.getByRole("button", { name: "Save Changes" });

test("a partial bill offers Save Changes and no Finalize", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save Draft" })).toBeNull();
});

test("removing items so payments cover the total saves the bill as paid", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockBillUpdates).toHaveLength(1));
  expect(mockBillUpdates[0]).toMatchObject({ net_amount: 300, paymentstatus: "finalized", finalized: true });
});

test("editing a partial bill that is still short keeps it partial", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Remove Kurti" }));
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockBillUpdates).toHaveLength(1));
  expect(mockBillUpdates[0]).toMatchObject({ net_amount: 500, paymentstatus: "partial", finalized: true });
});

test("a bill marked paid in installments goes back to partial when payments fall short", async () => {
  // Stored as paid, but its items now add up to more than the ₹300 received.
  mockBill = { ...partialBill, paymentstatus: "finalized" };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  expect(screen.queryByRole("button", { name: "Finalize" })).toBeNull();
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockBillUpdates).toHaveLength(1));
  expect(mockBillUpdates[0]).toMatchObject({ net_amount: 800, paymentstatus: "partial" });
});
