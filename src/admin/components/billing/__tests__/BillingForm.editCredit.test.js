import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

// A finalized bill keeps the store credit it took when it was finished. Choosing another customer
// on it must not apply that customer's balance: none of it was taken, and bill_edit refuses store
// credit going up (schema/migration_bill_edit_atomic.sql).

const mockToasts = [];
jest.mock("sonner", () => ({
  toast: { error: (title) => mockToasts.push(title), success: () => {}, warning: () => {} },
}));

Object.defineProperty(global, "crypto", {
  configurable: true,
  value: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
});

jest.mock("../CustomerSelector", () => (props) => (
  <button type="button" onClick={() => props.setSelectedCustomerId(8)}>
    Switch customer
  </button>
));

let mockBill;
let mockEditReply;
const mockEdits = [];
const CUSTOMERS = {
  7: { first_name: "Asha", last_name: "", phone: "999", store_credit: 0, discount_usage: [], exchanges: [] },
  8: { first_name: "Ravi", last_name: "", phone: "888", store_credit: 500, discount_usage: [], exchanges: [] },
};

const mockChain = (table) => {
  let customerId = null;
  const chain = {
    select: () => chain,
    eq: (col, v) => {
      if (col === "customerid") customerId = v;
      return chain;
    },
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: () => chain,
    delete: () => chain,
    update: () => chain,
    single: () =>
      Promise.resolve({
        data: table === "bills" ? mockBill : table === "customers" ? CUSTOMERS[customerId] : null,
        error: null,
      }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (name, args) => {
      if (name === "bill_edit") mockEdits.push(args);
      return Promise.resolve(name === "bill_edit" ? mockEditReply : { data: null, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const finalizedBill = (storeCreditUsed) => ({
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: CUSTOMERS[7],
  paymentstatus: "finalized",
  finalized: true,
  payment_amount: 1000 - storeCreditUsed,
  net_amount: 1000 - storeCreditUsed,
  salesmethodid: 1,
  store_credit_used: storeCreditUsed,
  applied_codes: [],
  document_type: "bos",
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  bill_items: [
    { bill_item_id: 11, product_name: "Kurti", quantity: 1, mrp: 1000, discount_total: 0, total: 1000, stitch_type: "unstitched" },
  ],
});

const saveChanges = () => screen.getByRole("button", { name: "Save Changes" });

beforeEach(() => {
  mockToasts.length = 0;
  mockEdits.length = 0;
  mockEditReply = { data: { billid: 330, excess: null }, error: null };
  clearBillingLookups();
});

test("another customer on a finalized bill does not apply their store credit", async () => {
  mockBill = finalizedBill(0);
  const onSubmit = jest.fn();
  render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Switch customer" }));
  await waitFor(() => expect(saveChanges()).toBeEnabled());
  fireEvent.click(saveChanges());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  expect(mockEdits[0].p_payload.bill).toMatchObject({ customerid: 8, store_credit_used: 0, net_amount: 1000 });
});

test("a bill paid with store credit says why its customer cannot change", async () => {
  mockBill = finalizedBill(200);
  mockEditReply = { data: null, error: { message: "BILL_CREDIT_CUSTOMER" } };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Switch customer" }));
  await waitFor(() => expect(saveChanges()).toBeEnabled());
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockToasts).toContain(
    "This bill was paid partly with the customer's store credit, so the customer cannot be changed. Put the customer back, or cancel the bill and make a new one.",
  ));
  expect(mockEdits[0].p_payload.bill.store_credit_used).toBe(200);
});
