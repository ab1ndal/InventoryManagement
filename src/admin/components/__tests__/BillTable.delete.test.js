import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillTable from "../BillTable";

const mockDb = { rows: [], current: null, items: [], failItemDeletes: 0, failBillDeletes: 0, stock: [], deleted: [] };

const mockChain = (table) => {
  let op = "select";
  const reply = () => {
    if (table === "bills" && op === "delete") {
      if (mockDb.failBillDeletes > 0) {
        mockDb.failBillDeletes -= 1;
        return { data: null, error: { message: "bill delete failed" } };
      }
      mockDb.deleted.push(table);
      return { data: null, error: null };
    }
    if (table === "bill_items" && op === "delete") {
      if (mockDb.failItemDeletes > 0) {
        mockDb.failItemDeletes -= 1;
        return { data: null, error: { message: "item delete failed" } };
      }
      const removed = mockDb.items;
      mockDb.items = [];
      mockDb.deleted.push(table);
      return { data: removed, error: null };
    }
    if (table === "bill_items") return { data: mockDb.items, error: null };
    if (table === "bills") return { data: mockDb.rows, error: null };
    return { data: [], error: null };
  };
  const chain = {
    select: () => chain,
    delete: () => {
      op = "delete";
      return chain;
    },
    eq: () => chain,
    in: () => chain,
    not: () => chain,
    order: () => chain,
    range: () => chain,
    single: () => Promise.resolve({ data: mockDb.current, error: null }),
    then: (res, rej) => Promise.resolve(reply()).then(res, rej),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (name, args) => {
      if (name === "stock_adjust") mockDb.stock.push(args);
      return Promise.resolve({ error: null });
    },
  },
}));

const bill = (overrides) => ({
  billid: 1,
  bill_number: "FY26-000217",
  document_type: "bos",
  customers: { first_name: "Asha", last_name: "" },
  orderdate: "2026-07-13",
  totalamount: 1105,
  paymentstatus: "draft",
  finalized: false,
  pdf_url: null,
  ...overrides,
});

const draftItems = () => [{ bill_item_id: 11, variantid: "v1", quantity: 2 }];

beforeEach(() => {
  mockDb.rows = [bill()];
  mockDb.current = { finalized: false, paymentstatus: "draft" };
  mockDb.items = draftItems();
  mockDb.failItemDeletes = 0;
  mockDb.failBillDeletes = 0;
  mockDb.stock = [];
  mockDb.deleted = [];
  window.confirm = jest.fn(() => true);
});

test.each([
  ["finalized", { paymentstatus: "finalized", finalized: true }],
  ["pending payment", { paymentstatus: "partial", finalized: true }],
])("a %s bill offers Cancel and no Delete", async (_label, overrides) => {
  mockDb.rows = [bill(overrides)];
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  expect(screen.getByLabelText("Cancel bill")).toBeInTheDocument();
  expect(screen.queryByLabelText("Delete draft")).not.toBeInTheDocument();
});

test("a cancelled draft offers no Delete, because its stock was already put back", async () => {
  mockDb.rows = [bill({ paymentstatus: "cancelled" })];
  render(<BillTable onEdit={() => {}} />);
  await screen.findByText("FY26-000217");
  expect(screen.queryByLabelText("Delete draft")).not.toBeInTheDocument();
});

test("the draft Delete confirm names the bill and the customer", async () => {
  window.confirm = jest.fn(() => false);
  render(<BillTable onEdit={() => {}} />);
  fireEvent.click(await screen.findByLabelText("Delete draft"));
  expect(window.confirm.mock.calls[0][0]).toContain("FY26-000217");
  expect(window.confirm.mock.calls[0][0]).toContain("Asha");
  expect(mockDb.stock).toHaveLength(0);
});

test("retrying after the items could not be removed restores stock only once", async () => {
  mockDb.failItemDeletes = 1;
  render(<BillTable onEdit={() => {}} />);

  fireEvent.click(await screen.findByLabelText("Delete draft"));
  fireEvent.click(await screen.findByLabelText("Delete draft"));

  await waitFor(() => expect(mockDb.deleted).toContain("bills"));
  expect(mockDb.stock).toEqual([
    { p_variant: "v1", p_delta: 2, p_reason: "bill_cancel", p_ref: "1" },
  ]);
});

test("retrying after the bill itself could not be removed restores stock only once", async () => {
  mockDb.failBillDeletes = 1;
  render(<BillTable onEdit={() => {}} />);

  fireEvent.click(await screen.findByLabelText("Delete draft"));
  fireEvent.click(await screen.findByLabelText("Delete draft"));

  await waitFor(() => expect(mockDb.deleted).toContain("bills"));
  expect(mockDb.stock).toHaveLength(1);
});

test("a bill finalized since the list loaded is not deleted", async () => {
  mockDb.current = { finalized: true, paymentstatus: "finalized" };
  render(<BillTable onEdit={() => {}} />);

  fireEvent.click(await screen.findByLabelText("Delete draft"));

  expect(await screen.findByLabelText("Delete draft")).toBeInTheDocument();
  expect(mockDb.deleted).toHaveLength(0);
  expect(mockDb.stock).toHaveLength(0);
});
