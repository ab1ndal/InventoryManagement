import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

let mockRole = "admin";
let mockLive = false;
let mockActions = [];

jest.mock("../../components/onlineOrders/onlineOrdersApi", () => ({
  ORDER_FILTERS: { to_check: { label: "To check" }, all: { label: "All" } },
  listOrders: async () => [],
  getMyRole: async () => mockRole,
  getCheckoutLive: async () => mockLive,
  action: async (p) => {
    mockActions.push(p);
    return { ok: true };
  },
}));
jest.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

import OnlineOrdersPage from "../OnlineOrdersPage";

beforeEach(() => {
  mockRole = "admin";
  mockLive = false;
  mockActions = [];
});

test("admin does not see the online checkout switch", async () => {
  render(<OnlineOrdersPage />);
  await screen.findByText("No orders here.");
  expect(screen.queryByRole("switch", { name: "Online checkout" })).not.toBeInTheDocument();
});

test("superadmin turns online checkout on after confirming", async () => {
  mockRole = "superadmin";
  render(<OnlineOrdersPage />);
  const toggle = await screen.findByRole("switch", { name: "Online checkout" });
  expect(toggle).toHaveAttribute("aria-checked", "false");
  fireEvent.click(toggle);
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Customers will be able to pay online");
  expect(mockActions).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(mockActions).toEqual([{ action: "set_live", live: true }]));
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
});
