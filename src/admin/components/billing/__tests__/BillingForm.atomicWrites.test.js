import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

// Records every supabase call so tests can assert what BillingForm wrote.
// CRA's jest config sets resetMocks: true, so state lives in plain objects
// reset in beforeEach instead of jest.fn implementations.
const mockDb = {
  calls: [], // { table, op, payload, filters, cols }
  rpcCalls: [], // { fn, args }
  rpcResult: () => ({ data: null, error: null }),
  customerCredit: 0,
  voucherRow: null,
  alterationCharge: 0,
  discounts: [],
  failWrite: null, // (call) => error message to fail that write with, or null
};

const mockResolve = (s) => {
  const failure = s.op !== "select" && mockDb.failWrite ? mockDb.failWrite(s) : null;
  if (failure) return { data: null, error: { message: failure } };
  if (s.table === "discounts" && s.op === "select") {
    return { data: mockDb.discounts, error: null };
  }
  if (s.table === "customers" && s.op === "select") {
    return {
      data: { first_name: "Asha", last_name: "", phone: "999", store_credit: mockDb.customerCredit },
      error: null,
    };
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
          alteration_charge: mockDb.alterationCharge,
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
  mockDb.alterationCharge = 0;
  mockDb.discounts = [];
  mockDb.failWrite = null;
  clearBillingLookups();
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

async function renderUnpaidBill(onSubmit = () => {}) {
  render(<BillingForm open onOpenChange={() => {}} onSubmit={onSubmit} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
}

test("a bill with nothing paid finalizes as partial: no method, no payment row, stock still moves", async () => {
  const onSubmit = jest.fn();
  await renderUnpaidBill(onSubmit);

  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  const billInsert = mockDb.calls.find((c) => c.table === "bills" && c.op === "insert");
  expect(billInsert.payload).toMatchObject({
    paymentstatus: "partial",
    finalized: true,
    payment_amount: 0,
    salesmethodid: null,
  });
  expect(billInsert.payload.net_amount).toBeGreaterThan(0);
  // bill_payments.amount must be > 0, and no money has moved yet
  expect(mockDb.calls.some((c) => c.table === "bill_payments" && c.op === "insert")).toBe(false);
  expect(rpcs("stock_adjust")).toEqual([
    { p_variant: "v1", p_delta: -2, p_reason: "bill_partial_finalize", p_ref: "42" },
  ]);
});

test("altered items still need their deposit, so a bill with nothing paid is refused", async () => {
  mockDb.alterationCharge = 100;
  await renderUnpaidBill();

  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));

  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));
  expect(mockToast.error[0][0]).toBe("Insufficient initial payment");
  expect(screen.queryByRole("button", { name: "Confirm Partial Payment" })).not.toBeInTheDocument();
  expect(mockDb.calls.some((c) => c.table === "bills" && c.op === "insert")).toBe(false);
});


// Stopgap: once the bill row exists, a later failure that leaves it in place must lock the
// form, so a second click cannot insert a second bill and move stock again.
const AUTO_CODE = {
  id: 1, code: "TEN", type: "percentage", value: 10, auto_apply: true, active: true,
  once_per_customer: false, exclusive: false, rules: {},
};
const countOf = (table, op) => mockDb.calls.filter((c) => c.table === table && c.op === op).length;
const unfinishedMsg = (step) =>
  `Bill FY26-SG0042 was saved but not finished. Do not enter it again. Close this window, and tell the owner which step failed: ${step}.`;

test("new finalize: a failure after the bill insert locks the form and a second click writes nothing", async () => {
  mockDb.discounts = [AUTO_CODE];
  mockDb.failWrite = (c) => (c.table === "discount_usage" ? "usage down" : null);
  await renderBillPaidByStoreCredit();
  await finalizeNewBill();

  expect(
    await screen.findByText(unfinishedMsg("recording the discount code use")),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save Draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Finalize" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
  expect(countOf("bills", "insert")).toBe(1);
  expect(rpcs("stock_adjust")).toHaveLength(1);
});

test("new partial finalize: a failure after the bill insert locks the form", async () => {
  mockDb.customerCredit = 100;
  mockDb.rpcResult = (fn) =>
    fn === "store_credit_adjust" ? { data: null, error: { message: "credit down" } } : { data: 0, error: null };
  render(<BillingForm open onOpenChange={() => {}} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  await screen.findAllByText(/Store Credit/);
  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));

  expect(await screen.findByText(unfinishedMsg("taking the store credit"))).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finalize" })).toBeDisabled();
  expect(countOf("bills", "insert")).toBe(1);
});

test("a refused voucher deletes the bill, leaves the form unlocked and can be retried", async () => {
  mockDb.voucherRow = {
    voucher_id: "VOUCH1", customerid: null, expiry_date: "2099-12-31",
    value: 300, redeemed: false, held_order_id: null,
  };
  mockDb.rpcResult = (fn) =>
    fn === "voucher_redeem" ? { data: false, error: null } : { data: 0, error: null };
  await renderUnpaidBill();
  await applyVoucher("VOUCH1");
  await screen.findAllByText(/Voucher #VOUCH1/);
  await finalizeNewBill();
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm & Finalize" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Finalize" }));
  await waitFor(() => expect(countOf("bills", "insert")).toBe(2));
});

test("a bill-item insert failure deletes the bill, leaves the form unlocked and can be retried", async () => {
  mockDb.failWrite = (c) => (c.table === "bill_items" && c.op === "insert" ? "items down" : null);
  await renderBillPaidByStoreCredit();
  await finalizeNewBill();
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm & Finalize" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Finalize" }));
  await waitFor(() => expect(countOf("bills", "insert")).toBe(2));
});

test("a successful finalize does not lock the form", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finalize" })).toBeEnabled();
});
