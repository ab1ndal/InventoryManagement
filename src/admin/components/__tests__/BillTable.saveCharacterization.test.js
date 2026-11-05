import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import BillTable from "../BillTable";

// Step 0 of the transactional bill save work: each test pins every write the cancel and
// delete-draft handlers make today, in order. The snapshots (committed beside this file)
// are the record and include known flaws; do not "fix" a snapshot to match a better
// behaviour. Reads are not recorded. CRA's jest config sets resetMocks: true, so state
// lives in plain objects reset in beforeEach.

const mockDb = { writes: [], rows: [], current: null, items: [], voucher: null };

const mockChain = (table) => {
  const s = { op: "select", payload: undefined, filters: [] };
  const run = () => {
    if (s.op !== "select") {
      mockDb.writes.push({
        kind: "table",
        table,
        op: s.op,
        ...(s.payload !== undefined ? { payload: s.payload } : {}),
        filters: s.filters,
      });
    }
    if (s.op !== "select") return Promise.resolve({ data: table === "bill_items" ? mockDb.items : null, error: null });
    if (table === "bill_items") return Promise.resolve({ data: mockDb.items, error: null });
    if (table === "bills") return Promise.resolve({ data: mockDb.rows, error: null });
    return Promise.resolve({ data: [], error: null });
  };
  const chain = {
    select: () => chain,
    update: (p) => { s.op = "update"; s.payload = p; return chain; },
    delete: () => { s.op = "delete"; return chain; },
    eq: (c, v) => { s.filters.push(["eq", c, v]); return chain; },
    in: (c, v) => { s.filters.push(["in", c, v]); return chain; },
    not: () => chain,
    order: () => chain,
    range: () => chain,
    single: () => Promise.resolve({ data: mockDb.current, error: null }),
    maybeSingle: () => Promise.resolve({ data: table === "vouchers" ? mockDb.voucher : null, error: null }),
    then: (res, rej) => run().then(res, rej),
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

jest.mock("../../../lib/activityLog", () => ({
  logActivity: (entry) => mockDb.writes.push({ kind: "activity_log", entry }),
}));
jest.mock("../billing/generateInvoicePdf", () => ({
  generateInvoicePdf: () => Promise.resolve(new Blob(["pdf"])),
}));

const bill = (overrides) => ({
  billid: 1,
  bill_number: "FY26-000217",
  document_type: "bos",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "" },
  orderdate: "2026-07-13",
  totalamount: 300,
  paymentstatus: "finalized",
  finalized: true,
  pdf_url: null,
  ...overrides,
});

const items = () => [{ bill_item_id: 11, variantid: "v1", quantity: 2 }];
const logged = () => waitFor(() => expect(mockDb.writes.some((w) => w.kind === "activity_log")).toBe(true));

beforeEach(() => {
  mockDb.writes = [];
  mockDb.rows = [bill()];
  mockDb.current = { finalized: true, paymentstatus: "finalized", store_credit_used: 100, net_amount: 200, payment_amount: 200 };
  mockDb.items = items();
  mockDb.voucher = { voucher_id: "VOUCH1" };
  window.confirm = jest.fn(() => true);
});

async function startCancel() {
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  fireEvent.click(screen.getByLabelText("Cancel bill"));
}

test("pins current behaviour: cancel a draft", async () => {
  mockDb.rows = [bill({ finalized: false, paymentstatus: "draft" })];
  mockDb.current = { finalized: false, paymentstatus: "draft", store_credit_used: 0, net_amount: null };
  await startCancel();
  fireEvent.click(await screen.findByRole("button", { name: "Cancel Draft" }));
  await logged();
  expect(mockDb.writes).toMatchSnapshot();
});

test("pins current behaviour: cancel a finalized bill that has no customer", async () => {
  mockDb.rows = [bill({ customerid: null, customers: null })];
  await startCancel();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  await logged();
  expect(mockDb.writes).toMatchSnapshot();
});

test("pins current behaviour: cancel a finalized bill and return the payment", async () => {
  await startCancel();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByText("Return payment to customer"));
  await logged();
  expect(mockDb.writes).toMatchSnapshot();
});

test("pins current behaviour: cancel a finalized bill and issue store credit", async () => {
  await startCancel();
  fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
  fireEvent.click(await screen.findByText("Issue store credit"));
  await logged();
  expect(mockDb.writes).toMatchSnapshot();
});

test("pins current behaviour: delete a draft", async () => {
  mockDb.rows = [bill({ finalized: false, paymentstatus: "draft" })];
  mockDb.current = { finalized: false, paymentstatus: "draft" };
  render(<BillTable onEdit={() => {}} />);
  fireEvent.click(await screen.findByLabelText("Delete draft"));
  await logged();
  expect(mockDb.writes).toMatchSnapshot();
});
