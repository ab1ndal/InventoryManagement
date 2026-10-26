import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import CustomerForm from "../CustomerForm";

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockOps = [];
let mockRpcs = [];
let mockToasts = [];
let mockRpcError = null;

const mockChain = (table) => {
  const op = { table, method: "select" };
  mockOps.push(op);
  const chain = {
    select: () => chain,
    eq: () => chain,
    insert: (p) => { op.method = "insert"; op.payload = p; return chain; },
    update: (p) => { op.method = "update"; op.payload = p; return chain; },
    upsert: (p) => { op.method = "upsert"; op.payload = p; return chain; },
    then: (resolve) => {
      if (op.method === "upsert") return resolve({ data: [{ ...op.payload, customerid: 42 }], error: null });
      return resolve({ data: [], error: null });
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
    rpc: async (name, args) => {
      mockRpcs.push({ name, args });
      return { data: null, error: mockRpcError };
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
      getUser: async () => ({ data: { user: { id: "admin-uuid" } }, error: null }),
    },
  },
}));
jest.mock("sonner", () => ({
  toast: {
    success: (m) => mockToasts.push(["success", m]),
    error: (m, o) => mockToasts.push(["error", m, o?.description]),
    warning: (m) => mockToasts.push(["warning", m]),
  },
}));


const existing = {
  customerid: 42,
  customer_ulid: "ulid42",
  first_name: "Asha",
  phone: "+911111111111",
  loyalty_tier: "bronze",
  store_credit: 100,
  marketing_opt_in: false,
};

beforeEach(() => {
  mockOps = [];
  mockRpcs = [];
  mockToasts = [];
  mockRpcError = null;
});

// Dialog + form mount is slow under parallel CPU load; the 1s default flaked.
const SLOW = { timeout: 5000 };

const openForm = async (defaults = existing, label = "Edit") => {
  render(<CustomerForm defaultValues={defaults} triggerLabel={label} />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await screen.findByPlaceholderText("0.00", {}, SLOW);
};

const submit = async (buttonName = "Update Customer") => {
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  await waitFor(() => expect(mockToasts.length).toBeGreaterThan(0), SLOW);
};

const upsertPayload = () =>
  mockOps.find((o) => o.table === "customers" && o.method === "upsert")?.payload;

test("editing only the phone writes no store_credit", async () => {
  await openForm();
  fireEvent.change(screen.getByPlaceholderText(/^Phone/), {
    target: { value: "+912222222222" },
  });
  await submit();
  expect(mockToasts[0][0]).toBe("success");
  expect(upsertPayload().phone).toBe("+912222222222");
  expect(upsertPayload()).not.toHaveProperty("store_credit");
  expect(mockRpcs).toEqual([]);
});

test("editing store credit 100 to 150 adjusts by +50", async () => {
  await openForm();
  fireEvent.change(screen.getByPlaceholderText("0.00"), {
    target: { value: "150" },
  });
  await submit();
  expect(mockToasts[0][0]).toBe("success");
  expect(mockRpcs).toEqual([
    {
      name: "store_credit_adjust",
      args: { p_customer: 42, p_delta: 50, p_reason: "manual_edit", p_ref: "42" },
    },
  ]);
  expect(upsertPayload()).not.toHaveProperty("store_credit");
});

test("a store_credit_adjust failure shows the error toast and saves nothing", async () => {
  mockRpcError = { message: "credit would go negative" };
  await openForm();
  fireEvent.change(screen.getByPlaceholderText("0.00"), {
    target: { value: "20" },
  });
  await submit();
  expect(mockToasts).toEqual([["error", "Error", "credit would go negative"]]);
  expect(upsertPayload()).toBeUndefined();
});

test("a new customer is inserted with its initial store credit", async () => {
  await openForm({}, "Add Customer");
  fireEvent.change(screen.getByPlaceholderText("Enter First Name"), {
    target: { value: "Ravi" },
  });
  // Without a phone the customer is a guest and the credit field is disabled.
  fireEvent.change(screen.getByPlaceholderText(/^Phone/), {
    target: { value: "+913333333333" },
  });
  fireEvent.change(screen.getByPlaceholderText("0.00"), {
    target: { value: "75" },
  });
  await submit("Save Customer");
  expect(mockToasts[0][0]).toBe("success");
  expect(upsertPayload().store_credit).toBe(75);
  expect(mockRpcs).toEqual([]);
});
