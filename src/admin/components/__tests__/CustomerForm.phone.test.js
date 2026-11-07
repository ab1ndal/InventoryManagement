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
let mockToasts = [];

const mockChain = (table) => {
  const op = { table, method: "select", filters: [] };
  mockOps.push(op);
  const chain = {
    select: () => chain,
    eq: (col, val) => { op.filters.push([col, val]); return chain; },
    upsert: (p) => { op.method = "upsert"; op.payload = p; return chain; },
    insert: (p) => { op.method = "insert"; op.payload = p; return chain; },
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
    rpc: async () => ({ data: null, error: null }),
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

beforeEach(() => {
  mockOps = [];
  mockToasts = [];
});

// Dialog + form mount is slow under parallel CPU load; the 1s default flaked.
const SLOW = { timeout: 5000 };

const openAddForm = async (defaults = {}) => {
  render(<CustomerForm defaultValues={defaults} triggerLabel="Add Customer" />);
  fireEvent.click(screen.getByRole("button", { name: "Add Customer" }));
  await screen.findByPlaceholderText(/^Phone/, {}, SLOW);
};

const upsertPayload = () =>
  mockOps.find((o) => o.table === "customers" && o.method === "upsert")?.payload;

test("country code starts as +91 and typed digits are kept as typed", async () => {
  await openAddForm();
  expect(screen.getByLabelText("Country code").value).toBe("+91");
  const phone = screen.getByPlaceholderText(/^Phone/);
  fireEvent.change(phone, { target: { value: "98100 00001" } });
  expect(phone.value).toBe("98100 00001");
  expect(screen.getByLabelText("Country code").value).toBe("+91");
});

test("an existing foreign number splits into its code and number", async () => {
  await openAddForm({ first_name: "Sam", phone: "+14155550123" });
  await waitFor(() => expect(screen.getByLabelText("Country code").value).toBe("+1"), SLOW);
  expect(screen.getByPlaceholderText(/^Phone/).value).toBe("4155550123");
});

test("digits typed after the default code are saved and duplicate-checked with +91", async () => {
  await openAddForm({ first_name: "Asha" });
  fireEvent.change(screen.getByPlaceholderText(/^Phone/), {
    target: { value: "98100 00001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Customer" }));
  await waitFor(() => expect(mockToasts.length).toBeGreaterThan(0), SLOW);
  expect(mockToasts[0][0]).toBe("success");
  const dupCheck = mockOps.find((o) => o.filters.some(([c]) => c === "phone"));
  expect(dupCheck.filters).toContainEqual(["phone", "+919810000001"]);
  expect(upsertPayload().phone).toBe("+919810000001");
});

test("opens with the values passed in from the bill search", async () => {
  await openAddForm({ first_name: "Anita", last_name: "Sharma" });
  expect(screen.getByDisplayValue("Anita")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Sharma")).toBeInTheDocument();
});
