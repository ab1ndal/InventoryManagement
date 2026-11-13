import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import BillingForm from "../BillingForm";
import { clearBillingLookups } from "../billingLookups";

const mockToasts = [];

jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: () => {},
    warning: () => {},
  },
}));

let mockBill;
const mockRpc = { calls: [], replies: [] };

// jsdom has no crypto.randomUUID; each call gives a new key so reuse is visible.
let mockUuid = 0;
Object.defineProperty(global, "crypto", {
  value: { randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, "0")}` },
  configurable: true,
});

const mockChain = (table) => {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    is: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve({ data: table === "bills" ? mockBill : null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res, rej) =>
      Promise.resolve({
        data: table === "salesmethods" ? [{ salesmethodid: 1, methodname: "Cash" }] : [],
        error: null,
      }).then(res, rej),
  };
  return chain;
};

jest.mock("../../../../lib/supabaseClient", () => ({
  supabase: {
    from: (table) => mockChain(table),
    rpc: (fn, args) => {
      mockRpc.calls.push({ fn, args });
      return Promise.resolve(mockRpc.replies.shift());
    },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

// Each method is a plain button, so a test can pick one (as in the save characterization test).
jest.mock("../../../../components/ui/select", () => {
  const React = require("react");
  const OnChange = React.createContext(null);
  return {
    Select: ({ onValueChange, children }) => (
      <OnChange.Provider value={onValueChange}>
        <div>{children}</div>
      </OnChange.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }) => <div>{children}</div>,
    SelectItem: ({ value, children }) => {
      const onValueChange = React.useContext(OnChange);
      return (
        <button type="button" onClick={() => onValueChange?.(value)}>
          {children}
        </button>
      );
    },
  };
});

// As stored on FY26-000313: an agreed final amount, so the stored total differs from what the items
// add up to before that adjustment.
const partialBill = {
  orderdate: "2026-09-30T00:00:00",
  customerid: null,
  customers: null,
  paymentstatus: "partial",
  finalized: true,
  totalamount: 800,
  net_amount: 800,
  final_amount: 800,
  payment_amount: 300,
  discount_total: 190,
  applied_codes: [],
  bill_payments: [{ payment_id: 1, amount: 300, recorded_at: "2026-09-30T12:00:00" }],
  bill_salespersons: [],
  linked_exchanges: [],
  document_type: "bos",
  bill_items: [
    {
      bill_item_id: 11,
      product_name: "Kurti",
      quantity: 1,
      mrp: 990,
      discount_total: 190,
      total: 800,
      stitch_type: "unstitched",
    },
  ],
};

const record = () => screen.getByRole("button", { name: "Record" });

beforeEach(() => {
  mockToasts.length = 0;
  mockRpc.calls = [];
  mockRpc.replies = [];
  mockBill = partialBill;
  clearBillingLookups();
});

test("recording a payment on an unchanged bill does not ask to resave it", async () => {
  // The stored total is deliberately not what the items add up to today.
  mockBill = { ...partialBill, totalamount: 777.77 };
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  fireEvent.click(record());

  expect(mockToasts).toEqual(["Enter a valid amount"]);
});

test("recording a payment after a real item edit still asks to save first", async () => {
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  fireEvent.click(screen.getByRole("button", { name: "Remove Kurti" }));
  fireEvent.click(record());

  expect(mockToasts).toEqual(["Unsaved item changes"]);
});

const enterPayment = async (amount) => {
  fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: amount } });
  const cash = await screen.findAllByRole("button", { name: "Cash" });
  fireEvent.click(cash[cash.length - 1]);
};

test("a refused payment says why in words staff can act on", async () => {
  mockRpc.replies.push({ data: null, error: { message: "BILL_NOT_PAYABLE" } });
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  await enterPayment("100");
  fireEvent.click(record());

  await waitFor(() => expect(mockToasts).toEqual([expect.stringMatching(/draft or has been cancelled/)]));
  expect(mockRpc.calls).toEqual([
    {
      fn: "bill_add_payment",
      args: { p_key: expect.any(String), p_billid: 330, p_amount: 100, p_salesmethodid: 1, p_recorded_at: null },
    },
  ]);
});

test("pressing Record again after a failure replays the same payment; a new amount is a new one", async () => {
  mockRpc.replies.push(
    { data: null, error: { message: "Failed to fetch" } },
    { data: null, error: { message: "Failed to fetch" } },
    { data: null, error: { message: "Failed to fetch" } },
  );
  render(<BillingForm billId={330} open onOpenChange={() => {}} />);
  await waitFor(() => expect(record()).toBeEnabled());

  await enterPayment("100");
  fireEvent.click(record());
  await waitFor(() => expect(mockRpc.calls).toHaveLength(1));
  await waitFor(() => expect(record()).toBeEnabled());
  fireEvent.click(record());
  await waitFor(() => expect(mockRpc.calls).toHaveLength(2));
  await waitFor(() => expect(record()).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText("Amount"), { target: { value: "150" } });
  fireEvent.click(record());
  await waitFor(() => expect(mockRpc.calls).toHaveLength(3));

  const [first, retry, changed] = mockRpc.calls.map((c) => c.args.p_key);
  expect(retry).toBe(first);
  expect(changed).not.toBe(first);
});
