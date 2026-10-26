import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import DiscountForm from "../DiscountForm";

// Radix Checkbox measures itself; jsdom has no ResizeObserver.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Plain functions: CRA resetMocks wipes jest.fn implementations between tests.
let mockOps = [];

const mockChain = (table) => {
  const op = { table, method: "select" };
  mockOps.push(op);
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    single: () => chain,
    insert: (p) => { op.method = "insert"; op.payload = p; return chain; },
    update: (p) => { op.method = "update"; op.payload = p; return chain; },
    then: (resolve) =>
      resolve({ data: op.method === "insert" ? { id: 9 } : [], error: null }),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: { from: (t) => mockChain(t) },
}));
jest.mock("../../../lib/activityLog", () => ({ logActivity: () => {} }));
jest.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));


beforeEach(() => {
  mockOps = [];
});

const saved = () => mockOps.find((o) => o.table === "discounts" && o.method !== "select");

test("new discount saves storefront_redeemable when 'Valid on website' is ticked", async () => {
  render(<DiscountForm defaultValues={null} onSuccess={() => {}} onCancel={() => {}} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Valid on website" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Discount" }));
  await waitFor(() => expect(saved()).toBeDefined());
  expect(saved().method).toBe("insert");
  expect(saved().payload.storefront_redeemable).toBe(true);
});

test("editing keeps storefront_redeemable false unless ticked", async () => {
  render(
    <DiscountForm
      defaultValues={{ id: 3, code: "SHOP10", type: "flat", value: 10, min_total: 0, storefront_redeemable: false }}
      onSuccess={() => {}}
      onCancel={() => {}}
    />
  );
  expect(screen.getByRole("checkbox", { name: "Valid on website" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Update Discount" }));
  await waitFor(() => expect(saved()).toBeDefined());
  expect(saved().method).toBe("update");
  expect(saved().payload.storefront_redeemable).toBe(false);
});
