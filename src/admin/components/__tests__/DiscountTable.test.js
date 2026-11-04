import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import DiscountTable from "../DiscountTable";

const mockToasts = [];

jest.mock("sonner", () => ({
  toast: {
    error: (title) => mockToasts.push(title),
    success: (title) => mockToasts.push(title),
  },
}));

jest.mock("../../../lib/activityLog", () => ({ logActivity: () => {} }));

const mockDb = { discounts: [], usedIn: [], failCheck: false, failDelete: false, writes: [] };

const mockChain = (table) => {
  let op = "select";
  const reply = () => {
    if (op !== "select") return { data: null, error: op === "delete" && mockDb.failDelete ? { message: "refused" } : null };
    if (table === "discounts") return { data: mockDb.discounts, error: null };
    if (table === "categories") return { data: [], error: null };
    if (mockDb.failCheck && table === "orders") return { data: null, error: { message: "offline" } };
    return { data: mockDb.usedIn.includes(table) ? [{ id: 1 }] : [], error: null };
  };
  const chain = {
    select: () => chain,
    update: (payload) => {
      op = "update";
      mockDb.writes.push({ op, table, payload });
      return chain;
    },
    delete: () => {
      op = "delete";
      mockDb.writes.push({ op, table });
      return chain;
    },
    eq: () => chain,
    filter: () => chain,
    limit: () => chain,
    then: (res, rej) => Promise.resolve(reply()).then(res, rej),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: (table) => mockChain(table) },
}));

const code = (overrides) => ({ id: 5, code: "DIWALI10", type: "percentage", value: 10, active: true, ...overrides });

beforeEach(() => {
  mockToasts.length = 0;
  mockDb.discounts = [code()];
  mockDb.usedIn = [];
  mockDb.failCheck = false;
  mockDb.failDelete = false;
  mockDb.writes = [];
});

const deleteButton = () => screen.findByRole("button", { name: "Delete DIWALI10" });

test("Switch off keeps the code and marks it inactive", async () => {
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Switch off" }));

  expect(await screen.findByRole("button", { name: "Switch on" })).toBeInTheDocument();
  expect(mockDb.writes).toEqual([{ op: "update", table: "discounts", payload: { active: false } }]);
  expect(screen.getByText("DIWALI10")).toBeInTheDocument();
});

test("tapping the bin never deletes straight away: a never-used code asks first, naming it", async () => {
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await deleteButton());

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Delete DIWALI10?")).toBeInTheDocument();
  expect(mockDb.writes).toHaveLength(0);

  fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(mockDb.writes).toEqual([{ op: "delete", table: "discounts" }]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("Keep closes the dialog without deleting", async () => {
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await deleteButton());
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Keep" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mockDb.writes).toHaveLength(0);
});

test.each(["discount_usage", "bills", "orders"])("a code found in %s cannot be deleted", async (table) => {
  mockDb.usedIn = [table];
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await deleteButton());

  await waitFor(() => expect(mockToasts).toContain("DIWALI10 has been used, so it cannot be deleted"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockDb.writes).toHaveLength(0);
});

test("when the usage check fails, nothing can be deleted and the failure is shown", async () => {
  mockDb.failCheck = true;
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await deleteButton());

  await waitFor(() => expect(mockToasts).toContain("Could not check whether this code has been used"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mockDb.writes).toHaveLength(0);
});

test("a delete the database refuses is shown and leaves the dialog open", async () => {
  mockDb.failDelete = true;
  render(<DiscountTable onEdit={() => {}} refresh={0} />);
  fireEvent.click(await deleteButton());
  fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));

  await waitFor(() => expect(mockToasts).toContain("Could not delete DIWALI10"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
