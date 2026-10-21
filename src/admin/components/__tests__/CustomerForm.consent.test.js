import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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
      if (op.table === "marketing_consents" && mockFailConsent) {
        return resolve({ data: null, error: { message: "rls denied" } });
      }
      return resolve({ data: [], error: null });
    },
  };
  return chain;
};
let mockFailConsent = false;

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
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

import CustomerForm from "../CustomerForm";

const existing = {
  customerid: 42,
  customer_ulid: "ulid42",
  first_name: "Asha",
  phone: "+911111111111",
  loyalty_tier: "bronze",
  store_credit: 0,
  marketing_opt_in: false,
};

beforeEach(() => {
  mockOps = [];
  mockToasts = [];
  mockFailConsent = false;
});

// Dialog + form mount is slow under parallel CPU load; the 1s default flaked.
const SLOW = { timeout: 5000 };

const openAndSubmit = async ({ toggleConsent }) => {
  render(<CustomerForm defaultValues={existing} triggerLabel="Edit" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const box = await screen.findByRole("checkbox", { name: "Send store offers on WhatsApp" }, SLOW);
  expect(box).toHaveAttribute("aria-checked", "false");
  if (toggleConsent) fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Update Customer" }));
  await waitFor(() => expect(mockToasts.some(([k]) => k === "success")).toBe(true), SLOW);
};

test("checking consent appends an opt_in row and sets the flag", async () => {
  await openAndSubmit({ toggleConsent: true });
  await waitFor(() =>
    expect(mockOps.some((o) => o.table === "customers" && o.method === "update")).toBe(true),
  );
  const upsert = mockOps.find((o) => o.method === "upsert");
  expect(upsert.payload).not.toHaveProperty("marketing_opt_in");
  const consent = mockOps.find((o) => o.table === "marketing_consents");
  expect(consent.method).toBe("insert");
  expect(consent.payload).toEqual({
    customerid: 42,
    action: "opt_in",
    source: "counter_form",
    recorded_by: "admin-uuid",
  });
  const flag = mockOps.find((o) => o.table === "customers" && o.method === "update");
  expect(flag.payload).toEqual({ marketing_opt_in: true });
});

test("unchanged consent writes no consent row", async () => {
  await openAndSubmit({ toggleConsent: false });
  expect(mockOps.some((o) => o.table === "marketing_consents")).toBe(false);
  expect(mockOps.some((o) => o.table === "customers" && o.method === "update")).toBe(false);
});

test("consent failure after save surfaces an error toast", async () => {
  mockFailConsent = true;
  await openAndSubmit({ toggleConsent: true });
  await waitFor(() =>
    expect(mockToasts).toContainEqual([
      "error",
      "WhatsApp consent not saved",
      "Could not record WhatsApp consent: rls denied",
    ]),
  );
  expect(mockOps.some((o) => o.table === "customers" && o.method === "update")).toBe(false);
});
