import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

const mockToasts = [];
const mockSuccessToasts = [];
jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: (title) => mockSuccessToasts.push(title),
    warning: () => {},
  },
}));

// jsdom has no crypto.randomUUID; each call gives a new key so reuse is visible.
let mockUuid = 0;
Object.defineProperty(global, "crypto", {
  configurable: true,
  value: { randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}` },
});

let mockBill;
// What the save's check reads back; the opened bill unless a test changes it.
let mockBillNow;
// What bill_edit answers: { data, error }.
let mockEditReply;
// The bill_edit calls: { p_key, p_billid, p_payload }.
const mockEdits = [];
// The bill each edit wrote.
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
    update: () => chain,
    single: () => Promise.resolve({ data: table === "bills" ? mockBillNow() : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (name, args) => {
      if (name !== "bill_edit") return Promise.resolve({ data: null, error: null });
      mockEdits.push(args);
      mockBillUpdates.push(args.p_payload.bill);
      return Promise.resolve(mockEditReply);
    },
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
  mockBillNow = () => mockBill;
  mockEditReply = { data: { billid: 330, excess: null }, error: null };
  mockToasts.length = 0;
  mockSuccessToasts.length = 0;
  mockEdits.length = 0;
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
  // The edit is checked against the bill as this window opened it, in the same call.
  expect(mockEdits[0]).toMatchObject({
    p_billid: 330,
    p_payload: { expect: { paymentstatus: "partial", payment_amount: 300 }, excess: null },
  });
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

// Another window recorded the last ₹500 after this one opened the bill. Saving this window's
// "partial, ₹300 received" over it would undo that payment and let the bill take more.
test("a bill paid in another window since it opened is not saved over", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  mockBillNow = () => ({ ...partialBill, paymentstatus: "finalized", payment_amount: 800 });
  fireEvent.click(screen.getByRole("button", { name: "Remove Kurti" }));
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockToasts).toContain("This bill changed in another window — reload"));
  expect(mockBillUpdates).toHaveLength(0);
});

test("a payment landing between the check and the write is caught too", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());

  mockEditReply = { data: null, error: { message: "BILL_STALE" } };
  fireEvent.click(saveChanges());

  await waitFor(() => expect(mockToasts).toContain("This bill changed in another window — reload"));
  expect(mockBillUpdates).toHaveLength(1);
});

test("an unchanged bill saves with no warning", async () => {
  const onSubmit = jest.fn();
  render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());
  fireEvent.click(saveChanges());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(mockToasts).toEqual([]);
});

// Owner rule 2026-11-12: money an edit leaves the shop holding over is given back as store
// credit (the usual choice) or cash, chosen by staff, and saved with the bill in one call.
describe("an edit below what was paid", () => {
  const paidBill = {
    ...partialBill,
    customerid: 7,
    customers: { first_name: "Asha", last_name: "Rao", phone: "+919800000000", store_credit: 0, discount_usage: [], exchanges: [] },
    paymentstatus: "finalized",
    payment_amount: 800,
    bill_payments: [],
    salesmethodid: 2,
  };

  test("asks first, defaulting to store credit, and saves the choice with the bill", async () => {
    mockBill = paidBill;
    mockEditReply = { data: { billid: 330, excess: { mode: "store_credit", amount: 500, customerid: 7 } }, error: null };
    const onSubmit = jest.fn();
    render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(saveChanges()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
    fireEvent.click(saveChanges());

    await screen.findByText(/Give back ₹500/);
    expect(mockEdits).toHaveLength(0);
    expect(screen.getByRole("radio", { name: /store credit/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save and give back" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(mockEdits).toHaveLength(1);
    expect(mockEdits[0].p_payload.excess).toEqual({ mode: "store_credit", amount: 500 });
    expect(mockEdits[0].p_payload.bill).toMatchObject({ net_amount: 300, customerid: 7 });
    expect(mockSuccessToasts).toContain("₹500 added to Asha Rao's store credit");
  });

  test("Keep Editing writes nothing", async () => {
    mockBill = paidBill;
    render(<BillingForm billId={330} open onOpenChange={() => {}} />);
    await waitFor(() => expect(saveChanges()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
    fireEvent.click(saveChanges());
    await screen.findByText(/Give back ₹500/);
    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));

    await waitFor(() => expect(screen.queryByText(/Give back/)).toBeNull());
    expect(mockEdits).toHaveLength(0);
  });

  test("a walk-in bill picks nothing and offers only a cash refund", async () => {
    mockBill = { ...paidBill, customerid: null, customers: null };
    const onSubmit = jest.fn();
    render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(saveChanges()).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
    fireEvent.click(saveChanges());
    await screen.findByText(/Give back ₹500/);

    const credit = screen.getByRole("radio", { name: /store credit/ });
    expect(credit).toBeDisabled();
    expect(credit).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Cash refund" })).not.toBeChecked();
    expect(screen.getByText(/add the customer to the bill first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and give back" })).toBeDisabled();

    // The refund method starts as the bill's own.
    fireEvent.click(screen.getByRole("radio", { name: "Cash refund" }));
    mockEditReply = { data: { billid: 330, excess: { mode: "refund", amount: 500, customerid: null } }, error: null };
    fireEvent.click(screen.getByRole("button", { name: "Save and give back" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(mockEdits[0].p_payload.excess).toEqual({ mode: "refund", amount: 500, salesmethodid: 2 });
    expect(mockSuccessToasts).toContain("Give the customer ₹500 back — recorded as a refund on the bill");
  });

  test("refund and credit already given back are not offered again", async () => {
    // ₹800 paid, ₹500 already credited at an earlier edit: the shop holds ₹300, the bill is ₹300.
    mockBill = {
      ...paidBill,
      payment_amount: 300,
      totalamount: 300,
      net_amount: 300,
      bill_items: [item(11, "Kurti", 300)],
      bill_payments: [
        { payment_id: 1, amount: 800, kind: "payment", recorded_at: "2026-09-30T12:00:00" },
        { payment_id: 2, amount: -500, kind: "store_credit", recorded_at: "2026-10-01T12:00:00" },
      ],
    };
    const onSubmit = jest.fn();
    render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
    await waitFor(() => expect(saveChanges()).toBeEnabled());
    // Shown in the payment history and on the invoice.
    expect(screen.getAllByText("To store credit")).toHaveLength(2);

    fireEvent.click(saveChanges());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByText(/Give back/)).toBeNull();
    expect(mockEdits[0].p_payload.excess).toBeNull();
  });
});
