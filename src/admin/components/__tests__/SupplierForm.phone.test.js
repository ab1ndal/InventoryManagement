import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SupplierForm from "../SupplierForm";

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockOps = [];
let mockToasts = [];

const mockChain = (table) => {
  const op = { table, method: "select" };
  mockOps.push(op);
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: () => chain,
    insert: (p) => { op.method = "insert"; op.payload = p; return chain; },
    update: (p) => { op.method = "update"; op.payload = p; return chain; },
    then: (resolve) => resolve({ data: { supplierid: 5 }, error: null }),
  };
  return chain;
};

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
  },
}));

beforeEach(() => {
  mockOps = [];
  mockToasts = [];
});

const SLOW = { timeout: 5000 };

const openAddForm = async () => {
  // The page opens the dialog itself; there is no trigger button.
  render(<SupplierForm openExternally setOpenExternally={() => {}} />);
  await screen.findByPlaceholderText("Phone", {}, SLOW);
};

const insertPayload = () =>
  mockOps.find((o) => o.table === "suppliers" && o.method === "insert")?.payload;

test("main phone has a +91 code box and keeps digits as typed", async () => {
  await openAddForm();
  expect(screen.getByLabelText("Country code").value).toBe("+91");
  const phone = screen.getByPlaceholderText("Phone");
  fireEvent.change(phone, { target: { value: "98100 00001" } });
  expect(phone.value).toBe("98100 00001");
});

test("saves the main phone with +91 and an extra landline as typed", async () => {
  await openAddForm();
  fireEvent.change(screen.getByPlaceholderText("Supplier name"), {
    target: { value: "Test Fabrics" },
  });
  fireEvent.change(screen.getByPlaceholderText("Phone"), {
    target: { value: "98100 00001" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Add number/ }));
  const extra = await screen.findByPlaceholderText("Landline / additional number");
  fireEvent.change(extra, { target: { value: "0120 2345678" } });
  expect(extra.value).toBe("0120 2345678");
  fireEvent.click(screen.getByRole("button", { name: "Save Supplier" }));
  await waitFor(() => expect(insertPayload()).toBeDefined(), SLOW);
  expect(insertPayload().phone).toBe("+919810000001");
  expect(insertPayload().additional_phones).toEqual(["01202345678"]);
});
