import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillingForm from "../BillingForm";

// Records every supabase call so tests can assert what BillingForm wrote.
// CRA's jest config sets resetMocks: true, so state lives in plain objects
// reset in beforeEach instead of jest.fn implementations.
const mockDb = {
  calls: [], // { table, op, payload, filters, cols }
  rpcCalls: [], // { fn, args }
  rpcResult: () => ({ data: null, error: null }),
  customerCredit: 0,
  voucherRow: null,
};

const mockResolve = (s) => {
  if (s.table === "customers" && s.op === "select") {
    if (s.cols === "store_credit") return { data: { store_credit: mockDb.customerCredit }, error: null };
    return { data: { first_name: "Asha", last_name: "", phone: "999" }, error: null };
  }
  if (s.table === "productsizecolors" && s.op === "select") {
    return { data: [{ variantid: "v1", stock: 5, size: "M", color: "Red" }], error: null };
  }
  if (s.table === "bills" && s.op === "insert") {
    return { data: { billid: 42, bill_number: "FY26-SG0042" }, error: null };
  }
  if (s.table === "vouchers" && s.op === "select") {
    return { data: mockDb.voucherRow, error: null };
  }
  return { data: s.single ? null : [], error: null };
};

const mockChain = (table) => {
  const s = { table, op: "select", payload: undefined, filters: [], cols: undefined };
  const run = () => {
    mockDb.calls.push(s);
    return Promise.resolve(mockResolve(s));
  };
  const chain = {
    select: (cols) => {
      if (s.op === "select") s.cols = cols;
      return chain;
    },
    insert: (p) => { s.op = "insert"; s.payload = p; return chain; },
    update: (p) => { s.op = "update"; s.payload = p; return chain; },
    delete: () => { s.op = "delete"; return chain; },
    eq: (c, v) => { s.filters.push(["eq", c, v]); return chain; },
    in: (c, v) => { s.filters.push(["in", c, v]); return chain; },
    is: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => { s.single = true; return run(); },
    maybeSingle: () => { s.single = true; return run(); },
    then: (res, rej) => run().then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (fn, args) => {
      mockDb.rpcCalls.push({ fn, args });
      return Promise.resolve(mockDb.rpcResult(fn, args));
    },
    storage: {
      from: () => ({
        remove: () => Promise.resolve({ error: null }),
        upload: () => Promise.resolve({ error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: null } }),
      }),
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

const mockToast = { success: [], error: [] };
jest.mock("sonner", () => ({
  toast: {
    success: (...a) => mockToast.success.push(a),
    error: (...a) => mockToast.error.push(a),
  },
}));

jest.mock("../../../../lib/activityLog", () => ({ logActivity: () => {} }));
jest.mock("../generateInvoicePdf", () => ({
  generateInvoicePdf: () => Promise.resolve(new Blob(["pdf"])),
}));

// Stand-in for the inventory picker: one click adds 2 units of variant v1 @ ₹150.
jest.mock("../AddItemDialog", () => (props) =>
  props.editItem ? null : (
    <button
      type="button"
      onClick={() =>
        props.onAdd({
          _id: "row1",
          source: "inventory",
          variantid: "v1",
          productid: "BC25001",
          product_name: "Kurti",
          quantity: 2,
          unit_type: "piece",
          mrp: 150,
          alteration_charge: 0,
          quickDiscountPct: 0,
          gstRate: 5,
          stitchType: "unstitched",
          size: "M",
          color: "Red",
        })
      }
    >
      Stub add item
    </button>
  ),
);


beforeEach(() => {
  mockDb.calls = [];
  mockDb.rpcCalls = [];
  mockDb.rpcResult = (fn) =>
    fn === "voucher_redeem" ? { data: true, error: null } : { data: 0, error: null };
  mockDb.customerCredit = 0;
  mockDb.voucherRow = null;
  mockToast.success = [];
  mockToast.error = [];
  window.open = () => null;
});

const rpcs = (fn) => mockDb.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);

async function finalizeNewBill() {
  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm & Finalize" }));
}

// Bill total is 2 × ₹150 = ₹300; the customer's ₹300 store credit covers it,
// so no payment method/amount is needed to finalize.
async function renderBillPaidByStoreCredit(onSubmit = () => {}) {
  mockDb.customerCredit = 300;
  render(<BillingForm open onOpenChange={() => {}} onSubmit={onSubmit} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  // wait for the store-credit auto-apply effect
  await screen.findAllByText(/Store Credit/);
}

test("finalizing 2 units of a variant calls stock_adjust with p_delta -2 and never writes stock directly", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  expect(rpcs("stock_adjust")).toEqual([
    { p_variant: "v1", p_delta: -2, p_reason: "bill_finalize", p_ref: "42" },
  ]);
  const directStockWrites = mockDb.calls.filter(
    (c) => c.table === "productsizecolors" && c.op !== "select",
  );
  expect(directStockWrites).toEqual([]);
});

test("using ₹300 store credit calls store_credit_adjust with p_delta -300 and never writes the balance directly", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  expect(rpcs("store_credit_adjust")).toEqual([
    { p_customer: 7, p_delta: -300, p_reason: "bill_finalize", p_ref: "42" },
  ]);
  const directCreditWrites = mockDb.calls.filter(
    (c) => c.table === "customers" && c.op === "update",
  );
  expect(directCreditWrites).toEqual([]);
});

async function applyVoucher(code) {
  fireEvent.change(screen.getByPlaceholderText("Enter voucher code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Voucher" }));
}

test("voucher is redeemed via voucher_redeem; a false result stops finalize with an error toast", async () => {
  const onSubmit = jest.fn();
  mockDb.voucherRow = {
    voucher_id: "VOUCH1",
    customerid: null,
    expiry_date: "2099-12-31",
    value: 300,
    redeemed: false,
    held_order_id: null,
  };
  mockDb.rpcResult = (fn) =>
    fn === "voucher_redeem" ? { data: false, error: null } : { data: 0, error: null };

  render(<BillingForm open onOpenChange={() => {}} onSubmit={onSubmit} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  await applyVoucher("VOUCH1");
  await screen.findAllByText(/Voucher #VOUCH1/);

  await finalizeNewBill();
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(rpcs("voucher_redeem")).toEqual([{ p_voucher: "VOUCH1", p_bill: 42 }]);
  expect(mockToast.error[0][0]).toMatch(/VOUCH1 can no longer be used/);
  expect(mockToast.success).toEqual([]);
  expect(onSubmit).not.toHaveBeenCalled();
  // nothing else hung off the refused bill, and the bill row itself is rolled back
  expect(rpcs("stock_adjust")).toEqual([]);
  expect(mockDb.calls.some((c) => c.table === "bill_items" && c.op === "insert")).toBe(false);
  expect(
    mockDb.calls.some(
      (c) => c.table === "bills" && c.op === "delete" && c.filters.some(([, col, v]) => col === "billid" && v === 42),
    ),
  ).toBe(true);
  // no direct redemption write
  expect(
    mockDb.calls.some((c) => c.table === "vouchers" && c.op === "update" && c.payload?.redeemed === true),
  ).toBe(false);
});

test("a voucher held for an online order shows the reserved message and is not applied", async () => {
  mockDb.voucherRow = {
    voucher_id: "HELD1",
    customerid: null,
    expiry_date: "2099-12-31",
    value: 300,
    redeemed: false,
    held_order_id: 991,
  };
  render(<BillingForm open onOpenChange={() => {}} />);
  await applyVoucher("HELD1");
  expect(await screen.findByText("This voucher is reserved for an online order")).toBeInTheDocument();
  expect(screen.queryByText(/Voucher #HELD1/)).not.toBeInTheDocument();
});
