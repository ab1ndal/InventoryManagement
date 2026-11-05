import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillTable from "../BillTable";

// Cancel with "Issue store credit" credits only the money the customer actually paid
// (bill_payments rows, else bills.payment_amount), never the amount payable. CRA's jest
// config sets resetMocks: true, so state lives in a plain object reset in beforeEach.

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
      const data =
        s.op !== "select" ? null : table === "bills" ? [bill()] : table === "bill_items" ? mockDb.items : [];
      const error = s.op === "select" && mockDb.failRead === table ? { message: "network down" } : null;
      return Promise.resolve({ data: error ? null : data, error }).then(res, rej);
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (fn, args) => {
      mockDb.writes.push({ kind: "rpc", fn, args });
      return Promise.resolve({ error: null });
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
  ...mockDb.billExtra,
  billid: 1,
  bill_number: "FY26-000217",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "" },
  orderdate: "2026-07-13",
  totalamount: 1000,
  paymentstatus: "finalized",
  finalized: true,
  pdf_url: null,
});

const creditWrites = () =>
  mockDb.writes
    .filter((w) => w.kind === "rpc" && w.fn === "store_credit_adjust")
    .map((w) => [w.args.p_reason, w.args.p_delta]);

beforeEach(() => {
  mockDb.writes = [];
  mockDb.readError = null;
  mockDb.billExtra = {};
  mockDb.failRead = null;
  mockToasts.length = 0;
  mockDb.items = [];
  mockDb.current = { store_credit_used: 0, payment_amount: null, bill_payments: [] };
});

async function openDialog() {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  fireEvent.click(screen.getByLabelText("Cancel bill"));
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
}

async function issueCredit() {
  fireEvent.click(await screen.findByText("Issue store credit"));
  await waitFor(() =>
    expect(mockDb.writes.some((w) => w.kind === "table" && w.table === "bills" && w.op === "update")).toBe(true)
  );
}

test("partial bill with a deposit credits the deposit", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: 200, bill_payments: [{ amount: 200 }] };
  await openDialog();
  await screen.findByText(/₹200\.00 paid by the customer/);
  await issueCredit();
  expect(creditWrites()).toEqual([["bill_cancel_credit", 200]]);
});

test("fully paid bill credits its received amount (payment_amount, no payment rows)", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: 1000, bill_payments: [] };
  await openDialog();
  await screen.findByText(/₹1,000\.00 paid by the customer/);
  await issueCredit();
  expect(creditWrites()).toEqual([["bill_cancel_credit", 1000]]);
});

test("bill with store credit used credits the cash paid plus a separate refund", async () => {
  mockDb.current = { store_credit_used: 300, payment_amount: 700, bill_payments: [] };
  await openDialog();
  await screen.findByText(/₹300\.00 of store credit used on this bill is also returned/);
  await issueCredit();
  expect(creditWrites()).toEqual([
    ["bill_cancel_refund", 300],
    ["bill_cancel_credit", 700],
  ]);
});

test("nothing paid writes no credit row and the dialog says so", async () => {
  mockDb.current = { store_credit_used: 0, payment_amount: null, bill_payments: [] };
  await openDialog();
  await screen.findByText(/Nothing was paid on this bill/);
  await issueCredit();
  expect(creditWrites()).toEqual([]);
});

test("failed payment read writes nothing and does not open the dialog", async () => {
  mockDb.readError = "read failed";
  await openDialog();
  await waitFor(() => expect(screen.queryByRole("button", { name: "Continue" })).not.toBeDisabled());
  expect(screen.queryByText("Issue store credit")).toBeNull();
  expect(mockDb.writes).toEqual([]);
});

test("the send button says WhatsApp, which is what it opens", async () => {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  expect(screen.getByLabelText("Send bill on WhatsApp")).toHaveAttribute("title", "Finalize bill first to send on WhatsApp");
  expect(screen.queryByLabelText(/SMS/)).not.toBeInTheDocument();
});

describe("stock on cancel follows bills.stock_reduced", () => {
  const stockWrites = () =>
    mockDb.writes.filter((w) => w.kind === "rpc" && w.fn === "stock_adjust").map((w) => [w.args.p_variant, w.args.p_delta]);
  const item = { bill_item_id: 11, variantid: "v1", quantity: 2 };
  const openStep1 = async () => {
    mockDb.items = [item];
    render(<BillTable onEdit={() => {}} />);
    await screen.findByText("FY26-000217");
    fireEvent.click(screen.getByLabelText("Cancel bill"));
  };
  const finishCancel = async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await issueCredit();
  };

  test("a bill that reduced stock gets it back", async () => {
    mockDb.billExtra = { stock_reduced: true };
    await openStep1();
    await screen.findByText(/This will restore stock for all items/);
    await finishCancel();
    expect(stockWrites()).toEqual([["v1", 2]]);
  });

  test("a bill that did not reduce stock adds none back and says so", async () => {
    mockDb.billExtra = { stock_reduced: false };
    await openStep1();
    await screen.findByText(/did not reduce stock, so stock will not change/);
    await finishCancel();
    expect(stockWrites()).toEqual([]);
  });

  test.each([["bill_items"], ["exchanges"]])("a failed %s read stops the cancel before any write", async (table) => {
    mockDb.billExtra = { stock_reduced: true };
    await openStep1();
    mockDb.failRead = table;
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    fireEvent.click(await screen.findByText("Issue store credit"));
    await waitFor(() => expect(mockToasts.map((t) => t.title)).toContain("Cancel failed"));
    expect(mockToasts.find((t) => t.title === "Cancel failed").description).toMatch(/nothing was changed: network down/);
    expect(mockDb.writes).toEqual([]);
  });

  test("an older bill restores by default", async () => {
    mockDb.billExtra = { stock_reduced: null };
    await openStep1();
    expect(await screen.findByLabelText(/Put this bill's items back in stock/)).toBeChecked();
    await finishCancel();
    expect(stockWrites()).toEqual([["v1", 2]]);
  });

  test("an older bill restores nothing when unticked", async () => {
    mockDb.billExtra = { stock_reduced: null };
    await openStep1();
    fireEvent.click(await screen.findByLabelText(/Put this bill's items back in stock/));
    await finishCancel();
    expect(stockWrites()).toEqual([]);
  });
});
