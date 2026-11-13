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
  bill: null, // row returned when an existing bill is opened
  existingItems: [], // bill_items rows a save of an existing bill reads
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
  if (s.table === "bills" && s.op === "select" && mockDb.bill) {
    return { data: mockDb.bill, error: null };
  }
  if (s.table === "bill_items" && s.op === "select") {
    return { data: mockDb.existingItems, error: null };
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


// bill_save answers with the bill; other RPCs succeed.
const mockRpcOk = (fn) => {
  if (fn === "bill_save") {
    return { data: { billid: 42, bill_number: "FY26-SG0042", replayed: false, negative_stock: [], payment: null }, error: null };
  }
  return { data: 0, error: null };
};
// A bill_save refusal: supabase-js puts the code in message and the cause in details.
const mockSaveRefused = (code, details = null) => (fn) =>
  fn === "bill_save" ? { data: null, error: { message: code, details } } : mockRpcOk(fn);

// jsdom has no crypto.randomUUID; a fixed key shows retries reuse it.
Object.defineProperty(global, "crypto", {
  value: { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
  configurable: true,
});

beforeEach(() => {
  mockDb.calls = [];
  mockDb.rpcCalls = [];
  mockDb.rpcResult = mockRpcOk;
  mockDb.customerCredit = 0;
  mockDb.voucherRow = null;
  mockDb.alterationCharge = 0;
  mockDb.discounts = [];
  mockDb.failWrite = null;
  mockDb.bill = null;
  mockDb.existingItems = [];
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

// A new bill is saved by one bill_save call: the database moves stock, takes credit and redeems
// the voucher in the same transaction, so nothing here writes them and nothing is ever deleted.
const writesOtherThanSave = () =>
  mockDb.calls.filter((c) => c.op !== "select").concat(mockDb.rpcCalls.filter((c) => c.fn !== "bill_save"));

test("finalizing 2 units sends them to bill_save, which moves the stock; nothing writes stock directly", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  const [save] = rpcs("bill_save");
  expect(save.p_op).toBe("finalize_create");
  expect(save.p_payload.items).toEqual([expect.objectContaining({ variantid: "v1", quantity: 2, billid: null })]);
  expect(save.p_payload.skip_stock).toBe(false);
  expect(rpcs("stock_adjust")).toEqual([]);
  expect(mockDb.calls.filter((c) => c.table === "productsizecolors" && c.op !== "select")).toEqual([]);
});

test("using ₹300 store credit sends store_credit_used 300 to bill_save and never writes the balance", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  expect(rpcs("bill_save")[0].p_payload.bill.store_credit_used).toBe(300);
  expect(rpcs("store_credit_adjust")).toEqual([]);
  expect(mockDb.calls.filter((c) => c.table === "customers" && c.op === "update")).toEqual([]);
});

async function applyVoucher(code) {
  fireEvent.change(screen.getByPlaceholderText("Enter voucher code"), { target: { value: code } });
  fireEvent.click(screen.getByRole("button", { name: "Apply Voucher" }));
}

test("a voucher bill_save refuses stops finalize with an error toast and writes nothing", async () => {
  const onSubmit = jest.fn();
  mockDb.voucherRow = {
    voucher_id: "VOUCH1",
    customerid: null,
    expiry_date: "2099-12-31",
    value: 300,
    redeemed: false,
    held_order_id: null,
  };
  mockDb.rpcResult = mockSaveRefused("BILL_VOUCHER_REFUSED", "VOUCH1");

  render(<BillingForm open onOpenChange={() => {}} onSubmit={onSubmit} prefilledCustomerId={7} />);
  fireEvent.click(screen.getByRole("button", { name: "Stub add item" }));
  await screen.findAllByText("Kurti");
  await applyVoucher("VOUCH1");
  await screen.findAllByText(/Voucher #VOUCH1/);

  await finalizeNewBill();
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(rpcs("bill_save")[0].p_payload.voucher_id).toBe("VOUCH1");
  expect(mockToast.error[0][0]).toMatch(/VOUCH1 can no longer be used/);
  expect(mockToast.success).toEqual([]);
  expect(onSubmit).not.toHaveBeenCalled();
  // the refused save rolled back in the database; nothing to undo here
  expect(writesOtherThanSave()).toEqual([]);
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

test("a bill with nothing paid finalizes as partial: no method, no first payment, stock still moves", async () => {
  const onSubmit = jest.fn();
  await renderUnpaidBill(onSubmit);

  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());

  const [save] = rpcs("bill_save");
  expect(save.p_op).toBe("partial_create");
  expect(save.p_payload.bill).toMatchObject({
    paymentstatus: "partial",
    finalized: true,
    payment_amount: 0,
    salesmethodid: null,
  });
  expect(save.p_payload.bill.net_amount).toBeGreaterThan(0);
  // bill_payments.amount must be > 0, and no money has moved yet
  expect(save.p_payload.first_payment).toBeNull();
  expect(save.p_payload.skip_stock).toBe(false);
  expect(writesOtherThanSave().filter((c) => c.table === "bill_payments")).toEqual([]);
});

test("altered items still need their deposit, so a bill with nothing paid is refused", async () => {
  mockDb.alterationCharge = 100;
  await renderUnpaidBill();

  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));

  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));
  expect(mockToast.error[0][0]).toBe("Insufficient initial payment");
  expect(screen.queryByRole("button", { name: "Confirm Partial Payment" })).not.toBeInTheDocument();
  expect(rpcs("bill_save")).toEqual([]);
});

// A failed save changed nothing, so the form stays open for a retry, and the retry sends the
// same key: if the first save did commit and only its answer was lost, the database replays it
// instead of saving a second bill.
test("a failed save leaves the form unlocked, and the retry reuses the key", async () => {
  mockDb.rpcResult = mockSaveRefused("canceling statement due to statement timeout");
  await renderBillPaidByStoreCredit();
  await finalizeNewBill();
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(mockToast.error[0][0]).toBe("Failed to save bill: canceling statement due to statement timeout");
  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm & Finalize" })).toBeEnabled();
  mockDb.rpcResult = mockRpcOk;
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Finalize" }));
  await waitFor(() => expect(rpcs("bill_save")).toHaveLength(2));
  expect(rpcs("bill_save")[1].p_key).toBe(rpcs("bill_save")[0].p_key);
  expect(writesOtherThanSave().filter((c) => c.op === "delete")).toEqual([]);
});

test("new partial: exchange credit already used elsewhere is refused with nothing written", async () => {
  mockDb.rpcResult = mockSaveRefused("BILL_EXCHANGE_USED");
  await renderUnpaidBill();
  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(mockToast.error[0][0]).toMatch(/exchange credit has already been used on another bill/);
  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(writesOtherThanSave()).toEqual([]);
});

test("new partial: store credit spent elsewhere is refused in plain words, with the balance now held", async () => {
  mockDb.rpcResult = mockSaveRefused("BILL_CREDIT_SHORT", '{"balance": 120.5, "requested": 500}');
  await renderUnpaidBill();
  fireEvent.click(await screen.findByRole("button", { name: "Partial Payment" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm Partial Payment" }));
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(mockToast.error[0][0]).toBe(
    "This customer's store credit is now ₹120.50, less than this bill uses (it was used on another bill). " +
      "Nothing was saved. Remove the customer and choose them again to load the new balance.",
  );
  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(writesOtherThanSave()).toEqual([]);
});

test("a successful finalize does not lock the form", async () => {
  const onSubmit = jest.fn();
  await renderBillPaidByStoreCredit(onSubmit);
  await finalizeNewBill();
  await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  expect(screen.queryByText(/was saved but not finished/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finalize" })).toBeEnabled();
});

const VOUCHER_ROW = {
  voucher_id: "VOUCH1", customerid: null, expiry_date: "2099-12-31",
  value: 100, redeemed: false, held_order_id: null,
};

// A saved draft: 2 × Kurti @ ₹150, ₹200 left to pay once the ₹100 voucher is applied.
const draftBill = (paymentAmount) => ({
  billid: 330,
  bill_number: "FY26-SG0330",
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "", phone: "999", store_credit: 0, discount_usage: [], exchanges: [] },
  document_type: "bos",
  paymentstatus: "draft",
  finalized: false,
  totalamount: 300,
  net_amount: null,
  final_amount: null,
  payment_amount: paymentAmount,
  salesmethodid: 1,
  saleslocationid: 1,
  store_credit_used: 0,
  applied_codes: [],
  notes: null,
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  bill_items: [
    {
      bill_item_id: 11, variantid: "v1", product_code: "BC25001", product_name: "Kurti",
      quantity: 2, unit_type: "piece", mrp: 150, discount_total: 0, total: 300,
      gst_rate: 5, stitch_type: "unstitched", alteration_charge: 0,
      productsizecolors: { size: "M", color: "Red" },
    },
  ],
});

// Finishing a draft is one bill_save call: the voucher, lines, stock, exchange links, credit and
// discount use are written by the database in one transaction, so nothing is left to undo. Only
// the new PDF's path is written afterwards.
const DRAFT_WRITE_TABLES = ["bills", "bill_items", "bill_salespersons", "exchanges", "vouchers", "discount_usage", "bill_payments"];
const isPdfPathWrite = (c) => c.table === "bills" && c.op === "update" && Object.keys(c.payload).join() === "pdf_url";
const draftDirectWrites = () =>
  mockDb.calls.filter((c) => DRAFT_WRITE_TABLES.includes(c.table) && c.op !== "select" && !isPdfPathWrite(c));

test.each([
  ["Finalize", "Confirm & Finalize", 200, "finalize_draft"],
  ["Partial Payment", "Confirm Partial Payment", 50, "partial_draft"],
])(
  "a draft's %s with a voucher is one bill_save call, with no direct writes",
  async (button, confirm, paid, op) => {
    mockDb.bill = draftBill(paid);
    mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
    mockDb.voucherRow = VOUCHER_ROW;
    render(<BillingForm billId={330} open onOpenChange={() => {}} />);
    await screen.findAllByText("Kurti");
    await applyVoucher("VOUCH1");
    await screen.findAllByText(/Voucher #VOUCH1/);
    fireEvent.click(screen.getByRole("button", { name: button }));
    fireEvent.click(await screen.findByRole("button", { name: confirm }));
    await waitFor(() => expect(rpcs("bill_save")).toHaveLength(1));

    const [call] = rpcs("bill_save");
    expect(call.p_op).toBe(op);
    expect(call.p_payload).toMatchObject({
      billid: 330,
      expect: { paymentstatus: "draft", payment_amount: paid },
      voucher_id: "VOUCH1",
      items: [expect.objectContaining({ bill_item_id: 11, billid: null, quantity: 2 })],
    });
    expect(call.p_payload.bill.document_type).toBeUndefined();
    expect(rpcs("voucher_redeem")).toEqual([]);
    expect(rpcs("voucher_release")).toEqual([]);
    expect(rpcs("stock_adjust")).toEqual([]);
    expect(rpcs("store_credit_adjust")).toEqual([]);
    expect(draftDirectWrites()).toEqual([]);
  },
);

test.each([
  ["Finalize", "Confirm & Finalize", 200],
  ["Partial Payment", "Confirm Partial Payment", 50],
])("a refused %s of a draft says why and writes nothing", async (button, confirm, paid) => {
  mockDb.bill = draftBill(paid);
  mockDb.existingItems = [{ variantid: "v1", quantity: 2 }];
  mockDb.voucherRow = VOUCHER_ROW;
  mockDb.rpcResult = mockSaveRefused("BILL_VOUCHER_REFUSED", "VOUCH1");
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await screen.findAllByText("Kurti");
  await applyVoucher("VOUCH1");
  await screen.findAllByText(/Voucher #VOUCH1/);
  fireEvent.click(screen.getByRole("button", { name: button }));
  fireEvent.click(await screen.findByRole("button", { name: confirm }));
  await waitFor(() => expect(mockToast.error.length).toBeGreaterThan(0));

  expect(mockToast.error.join(" ")).toMatch(/Voucher VOUCH1 can no longer be used/);
  expect(draftDirectWrites()).toEqual([]);
  expect(rpcs("bill_save")).toHaveLength(1);
});
