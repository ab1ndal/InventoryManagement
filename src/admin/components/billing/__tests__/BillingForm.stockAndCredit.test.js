import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

const mockToasts = [];
let mockBill;
const mockUpdates = [];
const mockSelects = [];

jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: () => {},
    warning: () => {},
  },
}));

const mockChain = (table) => {
  let updating = false;
  const chain = {
    select: (columns) => {
      mockSelects.push(String(columns));
      return chain;
    },
    insert: () => chain,
    delete: () => chain,
    update: (payload) => {
      mockUpdates.push({ table, payload });
      updating = true;
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: table === "bills" ? mockBill : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    // A bill update returns the row it changed; none would mean the bill changed elsewhere.
    then: (res, rej) =>
      Promise.resolve({ data: updating && table === "bills" ? [{ billid: 330 }] : [], error: null }).then(res, rej),
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
  paymentstatus: "draft",
  finalized: false,
  payment_amount: 500,
  salesmethodid: 1,
  store_credit_used: 0,
  applied_codes: [],
  document_type: "bos",
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  bill_items: [
    { bill_item_id: 11, product_name: "Kurti", quantity: 1, mrp: 5000, discount_total: 0, total: 5000, stitch_type: "unstitched" },
  ],
};

const stockTick = () => screen.getByRole("checkbox", { name: /Don't reduce stock/ });
// "Save Draft" on a draft, "Save Changes" once the bill is finalized.
const saveDraft = () => screen.getByRole("button", { name: /^Save (Draft|Changes)$/ });
const finalize = () => screen.getByRole("button", { name: "Finalize" });
const billUpdate = () => mockUpdates.find((u) => u.table === "bills").payload;

beforeEach(() => {
  mockToasts.length = 0;
  mockUpdates.length = 0;
  mockSelects.length = 0;
  mockBill = baseBill;
  clearBillingLookups();
});

test("the Don't reduce stock tick does not carry over to the next new bill", () => {
  const { rerender } = render(<BillingForm open onOpenChange={() => {}} />);
  fireEvent.click(stockTick());
  expect(stockTick()).toBeChecked();

  rerender(<BillingForm open={false} onOpenChange={() => {}} />);
  rerender(<BillingForm open onOpenChange={() => {}} />);

  expect(stockTick()).not.toBeChecked();
});

test("the tick does not describe itself as being for old bills", () => {
  render(<BillingForm open onOpenChange={() => {}} />);
  expect(stockTick().labels[0].textContent).not.toMatch(/old bill/i);
});

test("a saved bill that moved no stock keeps the tick on and locked", async () => {
  mockBill = { ...baseBill, stock_reduced: false };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(stockTick()).toBeChecked());
  expect(stockTick()).toBeDisabled();
});

test.each([[true], [null]])("a saved bill with stock_reduced %s leaves the tick off and free", async (stock_reduced) => {
  mockBill = { ...baseBill, stock_reduced };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(finalize()).toBeEnabled());
  expect(stockTick()).not.toBeChecked();
  expect(stockTick()).toBeEnabled();
});

test("a wrong amount is refused when the stock tick is on", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(finalize()).toBeEnabled());
  fireEvent.click(stockTick());

  fireEvent.click(finalize());

  expect(mockToasts).toContain("Payment mismatch");
  expect(await screen.findByRole("alert")).toHaveTextContent("Payment mismatch");
  expect(screen.queryByRole("button", { name: /Confirm/ })).not.toBeInTheDocument();
});

test("a correct amount still goes through to the confirm step with the stock tick on", async () => {
  mockBill = { ...baseBill, payment_amount: 5000 };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(finalize()).toBeEnabled());
  fireEvent.click(stockTick());

  fireEvent.click(finalize());

  expect(mockToasts).not.toContain("Payment mismatch");
  expect(await screen.findByRole("button", { name: /Confirm/ })).toBeInTheDocument();
});

const customerWithCredit = { ...baseBill.customers, store_credit: 1000 };

test("reopening a finalized bill saves the credit it used, not the customer's balance today", async () => {
  mockBill = { ...baseBill, finalized: true, paymentstatus: "finalized", store_credit_used: 200, customers: customerWithCredit };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveDraft()).toBeEnabled());

  expect(mockSelects.some((s) => /\bstore_credit_used\b/.test(s))).toBe(true);
  fireEvent.click(saveDraft());

  await waitFor(() => expect(mockUpdates.some((u) => u.table === "bills")).toBe(true));
  expect(billUpdate().store_credit_used).toBe(200);
});

test("a finalized bill that used no credit does not pick up the customer's balance", async () => {
  mockBill = { ...baseBill, finalized: true, paymentstatus: "finalized", store_credit_used: 0, customers: customerWithCredit };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveDraft()).toBeEnabled());

  expect(screen.queryByText("Paid via Store Credit")).not.toBeInTheDocument();
});

test("a draft has used no credit yet, so it still offers the balance like a new bill", async () => {
  mockBill = { ...baseBill, customers: customerWithCredit };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveDraft()).toBeEnabled());

  expect(screen.getByText("Paid via Store Credit")).toBeInTheDocument();
});
