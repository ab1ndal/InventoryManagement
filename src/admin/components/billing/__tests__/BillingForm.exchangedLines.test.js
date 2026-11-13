import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

// Exchange credit points at the bill line it came from (exchanges.original_bill_item_id). Saving
// an opened bill used to delete every line and insert them again, which dropped that link, so a
// later edit or cancel paid the exchanged value back a second time. These pin the in-place save
// and the locked exchanged lines.

const mockToasts = [];
jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: () => {},
    warning: () => {},
  },
}));

let mockUuid = 0;
Object.defineProperty(global, "crypto", {
  configurable: true,
  value: { randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}` },
});

let mockBill;
// Every bill_items write: { op, payload, filters }.
const mockItemWrites = [];
const mockEdits = [];

const mockChain = (table) => {
  const s = { op: "select", filters: [] };
  const run = () => {
    if (table === "bill_items" && s.op !== "select") {
      mockItemWrites.push({ op: s.op, payload: s.payload, filters: s.filters });
    }
    if (table === "bills" && s.single) return Promise.resolve({ data: mockBill, error: null });
    return Promise.resolve({ data: [], error: null });
  };
  const chain = {
    select: () => chain,
    eq: (c, v) => { s.filters.push(["eq", c, v]); return chain; },
    in: (c, v) => { s.filters.push(["in", c, v]); return chain; },
    is: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    delete: () => { s.op = "delete"; return chain; },
    insert: (p) => { s.op = "insert"; s.payload = p; return chain; },
    update: (p) => { s.op = "update"; s.payload = p; return chain; },
    single: () => { s.single = true; return run(); },
    maybeSingle: () => { s.single = true; return run(); },
    then: (res, rej) => run().then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (name, args) => {
      if (name === "bill_edit") mockEdits.push(args);
      return Promise.resolve({ data: { billid: 330, excess: null }, error: null });
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const line = (id, name, total, extra = {}) => ({
  bill_item_id: id,
  product_name: name,
  quantity: 1,
  mrp: total,
  discount_total: 0,
  total,
  stitch_type: "unstitched",
  exchanges: [],
  ...extra,
});

// Paid in one go, unstocked lines so saving touches no stock.
const paidBill = (items) => ({
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "Rao", phone: "+919800000000", store_credit: 0, discount_usage: [], exchanges: [] },
  paymentstatus: "finalized",
  finalized: true,
  stock_reduced: false,
  totalamount: 800,
  net_amount: 800,
  final_amount: null,
  payment_amount: 800,
  discount_total: 0,
  applied_codes: [],
  salesmethodid: 2,
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  document_type: "bos",
  bill_items: items,
});

beforeEach(() => {
  mockToasts.length = 0;
  mockItemWrites.length = 0;
  mockEdits.length = 0;
  clearBillingLookups();
});

const saveChanges = () => screen.getByRole("button", { name: "Save Changes" });
const openBill = async (onSubmit = () => {}) => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} onSubmit={onSubmit} />);
  await waitFor(() => expect(saveChanges()).toBeEnabled());
};

test("saving keeps line ids: kept lines update in place, only the removed line is deleted", async () => {
  mockBill = { ...paidBill([line(11, "Kurti", 300), line(12, "Dupatta", 500)]), payment_amount: 300, net_amount: 300 };
  const onSubmit = jest.fn();
  await openBill(onSubmit);

  fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
  fireEvent.click(saveChanges());
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  const deletes = mockItemWrites.filter((w) => w.op === "delete");
  expect(deletes).toEqual([
    { op: "delete", payload: undefined, filters: [["eq", "billid", 330], ["in", "bill_item_id", [12]]] },
  ]);
  const updates = mockItemWrites.filter((w) => w.op === "update");
  expect(updates).toHaveLength(1);
  expect(updates[0].filters).toEqual([["eq", "billid", 330], ["eq", "bill_item_id", 11]]);
  expect(updates[0].payload).toMatchObject({ billid: 330, product_name: "Kurti", quantity: 1, mrp: 300 });
  expect(mockItemWrites.some((w) => w.op === "insert")).toBe(false);
});

describe("an exchanged line", () => {
  const exchanged = (credit = 300) =>
    line(11, "Kurti", 300, { exchanges: [{ quantity: 1, credit_amount: credit }] });

  test("is marked, and cannot be removed or swapped", async () => {
    mockBill = paidBill([exchanged(), line(12, "Dupatta", 500)]);
    await openBill();

    expect(screen.getByText("Exchanged 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Kurti" }));
    expect(screen.getByRole("status")).toHaveTextContent("Already exchanged, so this item stays on the bill");
    expect(screen.getByRole("button", { name: "Remove Kurti" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Kurti" }));
    expect(screen.getByRole("status")).toHaveTextContent("cannot be swapped or repriced");
    expect(screen.getAllByRole("dialog")).toHaveLength(1); // the bill itself, no item editor
  });

  test("cannot go below the exchanged quantity", async () => {
    mockBill = paidBill([line(11, "Kurti", 300, { quantity: 2, mrp: 150, exchanges: [{ quantity: 2, credit_amount: 300 }] })]);
    await openBill();

    fireEvent.change(screen.getByDisplayValue("2"), { target: { value: "1" } });
    expect(screen.getByRole("status")).toHaveTextContent("2 already exchanged, so the quantity cannot go below 2");
  });

  test("returning another line saves without touching the exchanged one's id", async () => {
    mockBill = paidBill([exchanged(), line(12, "Dupatta", 500)]);
    await openBill();

    fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
    fireEvent.click(saveChanges());
    await screen.findByText(/Give back ₹500/);
    fireEvent.click(screen.getByRole("button", { name: "Save and give back" }));

    await waitFor(() => expect(mockEdits).toHaveLength(1));
    expect(mockEdits[0].p_payload.excess).toEqual({ mode: "store_credit", amount: 500 });
    expect(mockItemWrites.filter((w) => w.op === "delete")[0].filters).toEqual([
      ["eq", "billid", 330], ["in", "bill_item_id", [12]],
    ]);
  });

  test("an edit paying back below the exchange credit given is stopped before any write", async () => {
    // Staff gave ₹400 credit for the ₹300 Kurti; taking off the Dupatta leaves a ₹300 bill.
    mockBill = paidBill([exchanged(400), line(12, "Dupatta", 500)]);
    await openBill();

    fireEvent.click(screen.getByRole("button", { name: "Remove Dupatta" }));
    fireEvent.click(saveChanges());

    await screen.findByText("Already given back as exchange credit");
    expect(screen.queryByText(/Give back ₹/)).toBeNull();
    expect(mockEdits).toHaveLength(0);
    expect(mockItemWrites).toHaveLength(0);
  });
});
