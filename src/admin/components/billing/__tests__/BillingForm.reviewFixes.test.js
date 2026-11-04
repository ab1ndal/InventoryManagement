import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import BillingForm, { paymentDateFields } from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";
import { todayIST } from "../../../../utility/dateFormat";

const mockDb = { calls: [], bill: null, billReplies: [], activeDiscounts: [], savedDiscounts: [], failDiscounts: false };

const mockChain = (table) => {
  const call = { table, filters: [], op: "select", payload: null };
  mockDb.calls.push(call);
  const chain = {
    select: () => chain,
    insert: (payload) => {
      call.op = "insert";
      call.payload = payload;
      return chain;
    },
    update: (payload) => {
      call.op = "update";
      call.payload = payload;
      return chain;
    },
    eq: (col, val) => {
      call.filters.push(["eq", col, val]);
      return chain;
    },
    in: (col, val) => {
      call.filters.push(["in", col, val]);
      return chain;
    },
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => {
      if (table === "bills" && call.op === "select") {
        if (mockDb.billReplies.length > 0) return mockDb.billReplies.shift();
        return Promise.resolve({ data: mockDb.bill, error: null });
      }
      if (table === "bill_payments") {
        return Promise.resolve({
          data: { payment_id: 9, amount: 100, recorded_at: "2026-10-20T12:00:00" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) => {
      let reply = { data: [], error: null };
      if (table === "discounts") {
        const isSavedLookup = call.filters.some(([op]) => op === "in");
        if (mockDb.failDiscounts) reply = { data: null, error: { message: "down" } };
        else reply = { data: isSavedLookup ? mockDb.savedDiscounts : mockDb.activeDiscounts, error: null };
      }
      if (table === "salesmethods") reply = { data: [{ salesmethodid: 1, methodname: "Cash" }], error: null };
      return Promise.resolve(reply).then(res, rej);
    },
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({ remove: async () => ({}), upload: async () => ({ error: null }), createSignedUrl: async () => ({ data: {} }) }) },
  },
}));

const baseBill = {
  orderdate: "2026-09-30T00:00:00",
  customerid: 7,
  customers: { first_name: "Asha", last_name: "", phone: "999", store_credit: 0, discount_usage: [], exchanges: [] },
  bill_items: [],
  bill_payments: [],
  bill_salespersons: [],
  linked_exchanges: [],
  applied_codes: [],
  paymentstatus: "draft",
  notes: "",
};

const saveDraft = () => screen.getByRole("button", { name: "Save Draft" });
const dateField = () => screen.getByLabelText("Bill Date");
const discountCalls = () => mockDb.calls.filter((c) => c.table === "discounts");

beforeEach(() => {
  mockDb.calls = [];
  mockDb.bill = baseBill;
  mockDb.billReplies = [];
  mockDb.activeDiscounts = [];
  mockDb.savedDiscounts = [];
  mockDb.failDiscounts = false;
  clearBillingLookups();
});

test("a new bill cannot be saved when discounts fail to load, and Retry recovers it", async () => {
  mockDb.failDiscounts = true;
  render(<BillingForm open onOpenChange={() => {}} />);
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(saveDraft()).toBeDisabled();

  mockDb.failDiscounts = false;
  fireEvent.click(retry);
  await waitFor(() => expect(saveDraft()).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("a saved discount that has since been switched off keeps its terms on the bill", async () => {
  mockDb.bill = { ...baseBill, applied_codes: ["OLD10"] };
  mockDb.savedDiscounts = [{ id: 1, code: "OLD10", type: "percentage", value: 10, active: false }];
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);

  await waitFor(() => expect(saveDraft()).toBeEnabled());
  const lookup = discountCalls().find((c) => c.filters.some(([op]) => op === "in"));
  expect(lookup.filters).toContainEqual(["in", "code", ["OLD10"]]);
  expect(screen.getByText("1 applied")).toBeInTheDocument();
});

test("reopening a bill keeps a once-per-customer code that this same bill used", async () => {
  mockDb.bill = {
    ...baseBill,
    applied_codes: ["ONCE"],
    customers: { ...baseBill.customers, discount_usage: [{ code: "ONCE", billid: 370 }] },
  };
  mockDb.activeDiscounts = [{ id: 1, code: "ONCE", type: "percentage", value: 10, once_per_customer: true, active: true }];
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);

  await waitFor(() => expect(saveDraft()).toBeEnabled());
  expect(screen.getByText("1 applied")).toBeInTheDocument();
});

test("the same code used on a different bill is still removed", async () => {
  mockDb.bill = {
    ...baseBill,
    applied_codes: ["ONCE"],
    customers: { ...baseBill.customers, discount_usage: [{ code: "ONCE", billid: 111 }] },
  };
  mockDb.activeDiscounts = [{ id: 1, code: "ONCE", type: "percentage", value: 10, once_per_customer: true, active: true }];
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);

  await screen.findByText("None applied");
});

test("a late reply from a closed form does not refill it, and the reopened bill stays blocked until loaded", async () => {
  let releaseFirst;
  let releaseSecond;
  mockDb.billReplies = [
    new Promise((resolve) => { releaseFirst = resolve; }),
    new Promise((resolve) => { releaseSecond = resolve; }),
  ];
  const { rerender } = render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  rerender(<BillingForm billId={370} open={false} onOpenChange={() => {}} />);
  await act(async () => {
    releaseFirst({ data: { ...baseBill, orderdate: "2026-01-01T00:00:00" }, error: null });
  });

  rerender(<BillingForm billId={370} open onOpenChange={() => {}} />);
  expect(dateField().value).toBe("");
  expect(saveDraft()).toBeDisabled();

  await act(async () => {
    releaseSecond({ data: baseBill, error: null });
  });
  await waitFor(() => expect(dateField().value).toBe("2026-09-30"));
  await waitFor(() => expect(saveDraft()).toBeEnabled());
});

test("a bill that fails to load cannot be saved over the real one", async () => {
  mockDb.billReplies = [Promise.resolve({ data: null, error: { message: "down" } })];
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(mockDb.calls.some((c) => c.table === "bills")).toBe(true));
  await act(async () => {});
  expect(saveDraft()).toBeDisabled();
  expect(discountCalls()).toHaveLength(0);
});

test("clearing the bill date blocks saving", async () => {
  render(<BillingForm billId={370} open onOpenChange={() => {}} />);
  await waitFor(() => expect(saveDraft()).toBeEnabled());
  fireEvent.change(dateField(), { target: { value: "" } });
  expect(saveDraft()).toBeDisabled();
});

test("Cancel with no changes closes at once; with changes it asks first", async () => {
  const closes = [];
  render(<BillingForm billId={370} open onOpenChange={(o) => closes.push(o)} />);
  await waitFor(() => expect(saveDraft()).toBeEnabled());

  fireEvent.change(dateField(), { target: { value: "2026-09-29" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(closes).toEqual([]);

  fireEvent.click(await screen.findByRole("button", { name: "Keep Editing" }));
  expect(closes).toEqual([]);

  fireEvent.change(dateField(), { target: { value: "2026-09-30" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(closes).toEqual([false]);
});

describe("recording a payment on a bill entered late", () => {
  const partialBill = {
    ...baseBill,
    paymentstatus: "partial",
    finalized: true,
    net_amount: 500,
    totalamount: 0,
    bill_payments: [],
  };

  const paymentDate = () => screen.getByLabelText("Date payment was received");

  test("the date field offers from the bill's date up to today", async () => {
    mockDb.bill = partialBill;
    render(<BillingForm billId={370} open onOpenChange={() => {}} />);
    await waitFor(() => expect(paymentDate().min).toBe("2026-09-30"));
    expect(paymentDate().value).toBe(todayIST());
    expect(paymentDate().max).toBe(todayIST());
  });

  test("an earlier date is stored as that day; today keeps the database's time", () => {
    expect(paymentDateFields("2026-10-20")).toEqual({ recorded_at: "2026-10-20T12:00:00" });
    expect(paymentDateFields(todayIST())).toEqual({});
  });
});
