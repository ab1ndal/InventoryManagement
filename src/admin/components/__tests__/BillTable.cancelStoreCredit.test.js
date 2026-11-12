import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillTable from "../BillTable";

// Cancel is one bill_cancel call: the server moves stock, credit, exchanges, voucher and status
// in one transaction. These tests check what the screen sends, what it shows before the call
// (refund net of exchange credit already given), and how it reports the result or a refusal.
// CRA's jest config sets resetMocks: true, so state lives in a plain object reset in beforeEach.

// jsdom (CRA's jest env) has no crypto.randomUUID; browsers and Node do.
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, "crypto", { value: require("crypto").webcrypto, configurable: true });
}

const mockDb = { writes: [], current: null, readError: null };

const mockChain = (table) => {
  const s = { op: "select" };
  const chain = {
    select: () => chain,
    update: () => { s.op = "update"; return chain; },
    delete: () => { s.op = "delete"; return chain; },
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    range: () => chain,
    single: () =>
      Promise.resolve(
        mockDb.readError
          ? { data: null, error: { message: mockDb.readError } }
          : { data: mockDb.current, error: null }
      ),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => {
      if (s.op !== "select") mockDb.writes.push({ kind: "table", table, op: s.op });
      const data = s.op !== "select" ? null : table === "bills" ? [bill()] : [];
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (fn, args) => {
      mockDb.writes.push({ kind: "rpc", fn, args });
      const error = mockDb.rpcErrors.shift() || null;
      return Promise.resolve(error ? { data: null, error } : { data: mockDb.result, error: null });
    },
  },
}));
jest.mock("../../../lib/activityLog", () => ({ logActivity: () => {} }));
const mockToasts = [];
jest.mock("../../../components/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t) => mockToasts.push(t) }),
}));
jest.mock("../billing/generateInvoicePdf", () => ({
  generateInvoicePdf: () => Promise.resolve(new Blob(["pdf"])),
}));

const bill = () => ({
  billid: 1,
  bill_number: "FY26-000217",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "" },
  orderdate: "2026-07-13",
  totalamount: 1000,
  paymentstatus: "finalized",
  finalized: true,
  pdf_url: null,
  ...mockDb.billExtra,
});

const cancelCalls = () => mockDb.writes.filter((w) => w.kind === "rpc" && w.fn === "bill_cancel").map((w) => w.args);
const result = (extra = {}) => ({ stock: [], refund: 0, credit_added: 0, replayed: false, ...extra });

beforeEach(() => {
  mockDb.writes = [];
  mockDb.readError = null;
  mockDb.billExtra = {};
  mockDb.rpcErrors = [];
  mockDb.result = result();
  mockToasts.length = 0;
  mockDb.current = { store_credit_used: 0, payment_amount: null, bill_payments: [], bill_items: [] };
  window.open = jest.fn();
  URL.createObjectURL = jest.fn(() => "blob:receipt");
});

async function openStep1() {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  fireEvent.click(screen.getByLabelText("Cancel bill"));
}

async function openDialog() {
  await openStep1();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
}

const toastTitles = () => mockToasts.map((t) => t.title);

test("store credit: one bill_cancel call with what the screen showed, receipt uses the server figure", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: 200, bill_payments: [{ amount: 200 }], bill_items: [] };
  mockDb.result = result({ refund: 200, credit_added: 200, stock: [{ variantid: "v1", qty: 1 }] });
  await openDialog();
  await screen.findByText(/₹200\.00 will be added to/);
  fireEvent.click(screen.getByText("Issue store credit"));
  await waitFor(() => expect(toastTitles().some((t) => /₹200\.00 store credit added to Asha/.test(t))).toBe(true));

  const [call] = cancelCalls();
  expect(cancelCalls()).toHaveLength(1);
  expect(call).toMatchObject({
    p_billid: 1,
    p_mode: "store_credit",
    p_options: { expect: { finalized: true, paymentstatus: "finalized" }, restore_older_stock: true },
  });
  expect(call.p_key).toMatch(/^[0-9a-f-]{36}$/);
  // Nothing written outside the transaction.
  expect(mockDb.writes.filter((w) => w.kind !== "rpc" || w.fn !== "bill_cancel")).toEqual([]);
  expect(window.open).toHaveBeenCalled();
});

test("exchange credit already given is taken off the refund in the dialog", async () => {
  mockDb.current = {
    store_credit_used: 0,
    payment_amount: 1000,
    bill_payments: [],
    bill_items: [{ exchanges: [{ credit_amount: 300 }] }, { exchanges: [] }],
  };
  await openDialog();
  expect(await screen.findByText("Less exchange credit already given")).toBeInTheDocument();
  expect(screen.getByText("−₹300.00")).toBeInTheDocument();
  expect(screen.getByText(/Hand back ₹700\.00/)).toBeInTheDocument();
  expect(screen.getByText(/₹700\.00 will be added to/)).toBeInTheDocument();
});

test("no exchange: the exchange line is not shown", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: 1000, bill_payments: [], bill_items: [] };
  await openDialog();
  await screen.findByText(/Hand back ₹1,000\.00/);
  expect(screen.queryByText("Less exchange credit already given")).toBeNull();
});

test("exchange credit covering everything paid says nothing will be added", async () => {
  mockDb.current = {
    store_credit_used: 0,
    payment_amount: 200,
    bill_payments: [],
    bill_items: [{ exchanges: [{ credit_amount: 500 }] }],
  };
  await openDialog();
  await screen.findByText(/Nothing is left to refund after exchange credit/);
  expect(screen.getByText(/Nothing to hand back/)).toBeInTheDocument();
});

test("exchange credit already paid out comes off the refund, then store credit", async () => {
  // 1000 of exchange credit paid an 800 bill; 200 went back as cash. 100 was also paid in cash.
  mockDb.current = {
    store_credit_used: 0,
    payment_amount: 100,
    exchange_credit_used: 800,
    bill_payments: [],
    bill_items: [],
    exchanges: [{ credit_amount: 1000 }],
  };
  await openDialog();
  expect(await screen.findByText("Less exchange credit already paid out")).toBeInTheDocument();
  expect(screen.getByText("−₹200.00")).toBeInTheDocument();
  expect(screen.getByText(/Nothing to hand back/)).toBeInTheDocument();
  expect(screen.getByText(/₹100\.00 paid\s+out from it will be taken from the customer's store credit/)).toBeInTheDocument();
});

test("nothing paid says so", async () => {
  await openDialog();
  await screen.findByText(/Nothing was paid on this bill/);
});

test("store credit used on the bill is mentioned", async () => {
  mockDb.current = { store_credit_used: 300, payment_amount: 700, bill_payments: [], bill_items: [] };
  await openDialog();
  await screen.findByText(/₹300\.00 of store credit used on this bill is also returned/);
});

test("return payment sends return_payment and tells staff what to hand back", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: 1000, bill_payments: [], bill_items: [] };
  mockDb.result = result({ refund: 1000 });
  await openDialog();
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await waitFor(() => expect(toastTitles().some((t) => /Hand back ₹1,000\.00/.test(t))).toBe(true));
  expect(cancelCalls().map((c) => c.p_mode)).toEqual(["return_payment"]);
});

test("failed payment read calls nothing and does not open the dialog", async () => {
  mockDb.readError = "read failed";
  await openDialog();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Continue" })).not.toBeDisabled());
  expect(screen.queryByText("Issue store credit")).toBeNull();
  expect(mockDb.writes).toEqual([]);
});

test("a draft cancels in one step with mode draft", async () => {
  mockDb.billExtra = { finalized: false, paymentstatus: "draft" };
  mockDb.result = result({ stock: [{ variantid: "v1", qty: 2 }] });
  await openStep1();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Draft" }));
  await waitFor(() => expect(toastTitles()).toContain("Bill #1 cancelled. Stock restored."));
  expect(cancelCalls()).toMatchObject([
    { p_mode: "draft", p_options: { expect: { finalized: false, paymentstatus: "draft" } } },
  ]);
});

test("a finalized bill without a customer cancels with mode no_customer", async () => {
  mockDb.billExtra = { customerid: null, customers: null };
  await openStep1();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await waitFor(() => expect(toastTitles()).toContain("Bill #1 cancelled. Stock not changed. No customer on record."));
  expect(cancelCalls().map((c) => c.p_mode)).toEqual(["no_customer"]);
});

test.each([
  ["BILL_ALREADY_CANCELLED", "This bill is already cancelled. Refresh the list."],
  ["BILL_STALE", "This bill changed since the list loaded. Refresh and try again."],
  ["BILL_ONLINE", "Cancel website orders from the Orders screen."],
  ["BILL_EXCHANGE_PAID_OUT", expect.stringMatching(/Cancelling would pay it twice/)],
])("refusal %s is shown in plain words", async (code, words) => {
  mockDb.rpcErrors = [{ message: code }];
  await openDialog();
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await waitFor(() => expect(toastTitles()).toContain("Cancel failed"));
  expect(mockToasts.find((t) => t.title === "Cancel failed").description).toEqual(words);
});

test("pressing again after a failure reuses the key, so the server replays instead of cancelling twice", async () => {
  mockDb.rpcErrors = [{ message: "Failed to fetch" }];
  await openDialog();
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await waitFor(() => expect(toastTitles()).toContain("Cancel failed"));
  fireEvent.click(screen.getByText("Return payment to customer"));
  await waitFor(() => expect(cancelCalls()).toHaveLength(2));
  const [first, second] = cancelCalls();
  expect(second.p_key).toBe(first.p_key);
});

test("closing the dialog and starting again uses a new key", async () => {
  mockDb.rpcErrors = [{ message: "Failed to fetch" }];
  await openDialog();
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await waitFor(() => expect(toastTitles()).toContain("Cancel failed"));
  fireEvent.click(screen.getByRole("button", { name: "Go Back" }));
  fireEvent.click(screen.getByLabelText("Cancel bill"));
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await waitFor(() => expect(cancelCalls()).toHaveLength(2));
  const [first, second] = cancelCalls();
  expect(second.p_key).not.toBe(first.p_key);
});

test("the send button says WhatsApp, which is what it opens", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  expect(screen.getByLabelText("Send bill on WhatsApp")).toHaveAttribute("title", "Finalize bill first to send on WhatsApp");
  expect(screen.queryByLabelText(/SMS/)).not.toBeInTheDocument();
});

test("a cancelled bill cannot be edited or cancelled again", async () => {
  mockDb.billExtra = { paymentstatus: "cancelled" };
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  expect(screen.queryByLabelText("Edit bill")).toBeNull();
  expect(screen.getByLabelText("Cancelled bill, cannot be edited")).toBeInTheDocument();
  expect(screen.queryByLabelText("Cancel bill")).toBeNull();
});

describe("stock choice on cancel", () => {
  const finishCancel = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByText("Issue store credit"));
    await waitFor(() => expect(cancelCalls()).toHaveLength(1));
  };

  test("a bill that reduced stock says it will restore", async () => {
    mockDb.billExtra = { stock_reduced: true };
    await openStep1();
    await screen.findByText(/This will restore stock for all items/);
  });

  test("a bill that did not reduce stock says so", async () => {
    mockDb.billExtra = { stock_reduced: false };
    await openStep1();
    await screen.findByText(/did not reduce stock, so stock will not change/);
  });

  test("an older bill restores by default", async () => {
    mockDb.billExtra = { stock_reduced: null };
    await openStep1();
    expect(await screen.findByLabelText(/Put this bill's items back in stock/)).toBeChecked();
    await finishCancel();
    expect(cancelCalls()[0].p_options.restore_older_stock).toBe(true);
  });

  test("an older bill sends restore_older_stock false when unticked", async () => {
    mockDb.billExtra = { stock_reduced: null };
    await openStep1();
    fireEvent.click(await screen.findByLabelText(/Put this bill's items back in stock/));
    await finishCancel();
    expect(cancelCalls()[0].p_options.restore_older_stock).toBe(false);
  });
});
