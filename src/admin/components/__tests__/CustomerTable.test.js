import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";

const mockCustomers = [
  { customerid: 1, customer_ulid: "u1", first_name: "Asha", phone: "+911111111111", community_status: "not_added", created_at: "2026-01-02" },
  { customerid: 2, customer_ulid: "u2", first_name: "Bina", phone: "+912222222222", community_status: "member", created_at: "2026-01-01" },
];
// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockUpdates = [];

const mockChain = (table) => {
  let op = "select";
  let payload;
  let ids;
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    order: () => chain,
    update: (p) => { op = "update"; payload = p; return chain; },
    in: (_col, v) => { ids = v; return chain; },
    then: (resolve) => {
      if (op === "update") {
        mockUpdates.push({ table, payload, ids });
        return resolve({ data: ids.map((id) => ({ customerid: id })), error: null });
      }
      return resolve({ data: table === "customers" ? mockCustomers : [], error: null });
    },
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
jest.mock("sonner", () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }));

import CustomerTable from "../CustomerTable";

beforeEach(() => {
  mockUpdates = [];
});

test("shows community status with human labels", async () => {
  render(<CustomerTable />);
  await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
  const rowA = screen.getByText("Asha").closest("tr");
  const rowB = screen.getByText("Bina").closest("tr");
  expect(within(rowA).getByText("Not added")).toBeInTheDocument();
  expect(within(rowB).getByText("Member")).toBeInTheDocument();
});

test("filters to customers not yet added to the community", async () => {
  render(<CustomerTable />);
  await waitFor(() => expect(screen.getByText("Bina")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Filter by community status"), {
    target: { value: "not_added" },
  });
  await waitFor(() => expect(screen.queryByText("Bina")).not.toBeInTheDocument());
  expect(screen.getByText("Asha")).toBeInTheDocument();
});

test("select all on page then bulk-mark as member in one update", async () => {
  render(<CustomerTable />);
  await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("checkbox", { name: "Select all on page" }));
  expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Member" }));
  await waitFor(() => expect(mockUpdates).toHaveLength(1));
  expect(mockUpdates[0].table).toBe("customers");
  expect(mockUpdates[0].ids).toEqual([1, 2]);
  expect(mockUpdates[0].payload.community_status).toBe("member");
  await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
});
