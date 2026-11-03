import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import OnlineOrdersPage from "../OnlineOrdersPage";

let mockRole = "admin";
let mockLive = false;
let mockActions = [];
let mockListCalls = [];
let mockOrderDetailMounts = [];
let mockOnChanged = null;
let badgeRefreshes = 0;

jest.mock("../../components/onlineOrders/onlineOrdersApi", () => ({
  DEFAULT_QUEUE: "needs_action",
  ORDER_QUEUES: {
    needs_action: { label: "Needs action", counted: true },
    closed: { label: "Closed" },
  },
  listOrders: async (q) => {
    mockListCalls.push(q);
    return q === "closed"
      ? [
          {
            id: "o2",
            order_ref: "WEB-000002",
            status: "delivered",
            contact_name: "Ravi",
            contact_phone: "+918888888888",
            order_items: [],
          },
        ]
      : [
          {
            id: "o1",
            order_ref: "WEB-000001",
            status: "paid",
            contact_name: "Asha",
            contact_phone: "+919999999999",
            order_items: [],
          },
        ];
  },
  searchOrders: async () => [],
  countOrders: async () => ({ needs_action: 1 }),
  getMyRole: async () => mockRole,
  getCheckoutLive: async () => mockLive,
  action: async (p) => {
    mockActions.push(p);
    return { ok: true };
  },
}));
jest.mock("../../components/onlineOrders/OrderDetail", () => {
  const { useEffect } = jest.requireActual("react");
  return function MockOrderDetail({ orderId, onChanged }) {
    mockOnChanged = onChanged;
    useEffect(() => {
      mockOrderDetailMounts.push(orderId);
    }, [orderId]);
    return <div>Order detail {orderId}</div>;
  };
});
jest.mock("sonner", () => ({ toast: { error: () => {}, success: () => {} } }));

// The same two sibling routes as src/App.js, under a layout that passes the badge refresher.
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin"
          element={<Outlet context={{ refreshOrdersNeedingAction: () => (badgeRefreshes += 1) }} />}
        >
          <Route path="online-orders" element={<OnlineOrdersPage />} />
          <Route path="online-orders/:orderId" element={<OnlineOrdersPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const pane = (id) => screen.getByTestId(id);

beforeEach(() => {
  mockRole = "admin";
  mockLive = false;
  mockActions = [];
  mockListCalls = [];
  mockOrderDetailMounts = [];
  mockOnChanged = null;
  badgeRefreshes = 0;
  window.scrollTo = () => {};
  window.scrollBy = () => {};
});

test("admin does not see the online checkout switch", async () => {
  renderAt("/admin/online-orders");
  await screen.findByText("WEB-000001");
  expect(screen.queryByRole("switch", { name: "Online checkout" })).not.toBeInTheDocument();
});

test("superadmin turns online checkout on after confirming", async () => {
  mockRole = "superadmin";
  renderAt("/admin/online-orders");
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

test("without an order the list shows and the placeholder is for xl only", async () => {
  renderAt("/admin/online-orders");
  await screen.findByText("WEB-000001");
  expect(pane("list-pane")).not.toHaveClass("hidden");
  expect(pane("order-pane")).toHaveClass("hidden", "xl:block");
  expect(screen.getByText("Select an order to see its details.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to orders" })).not.toBeInTheDocument();
});

test("opening the URL of an order shows it, with the list hidden below xl", async () => {
  renderAt("/admin/online-orders/o1");
  expect(await screen.findByText("Order detail o1")).toBeInTheDocument();
  expect(pane("list-pane")).toHaveClass("hidden", "xl:block");
  expect(pane("order-pane")).not.toHaveClass("hidden");
  expect(screen.getByRole("link", { name: "Back to orders" })).toHaveClass("xl:hidden");
  expect(await screen.findByRole("button", { name: /WEB-000001/ })).toHaveAttribute("aria-current", "true");
});

test("a row opens the order and Back returns to the same queue and search without reloading", async () => {
  renderAt("/admin/online-orders");
  await screen.findByText("WEB-000001");
  fireEvent.click(screen.getByRole("tab", { name: "Closed" }));
  fireEvent.click(await screen.findByRole("button", { name: /WEB-000002/ }));
  expect(await screen.findByText("Order detail o2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Back to orders" }));
  expect(await screen.findByText("Select an order to see its details.")).toBeInTheDocument();

  expect(screen.getByRole("tab", { name: "Closed" })).toHaveAttribute("aria-selected", "true");
  // Stayed mounted: the first load and the one tab switch, nothing from navigating.
  expect(mockListCalls).toEqual(["needs_action", "closed"]);
});

test("search text survives opening an order and coming back", async () => {
  renderAt("/admin/online-orders");
  const row = await screen.findByRole("button", { name: /WEB-000001/ });
  const box = screen.getByRole("searchbox", { name: "Search orders" });
  fireEvent.change(box, { target: { value: "Asha" } });
  fireEvent.click(row);
  await screen.findByText("Order detail o1");
  fireEvent.click(screen.getByRole("link", { name: "Back to orders" }));
  await screen.findByText("Select an order to see its details.");
  expect(screen.getByRole("searchbox", { name: "Search orders" })).toBe(box);
  expect(box).toHaveValue("Asha");
});

test("Back goes back to where the list was scrolled", async () => {
  const scrolledTo = [];
  window.scrollTo = (x, y) => scrolledTo.push(y);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 420 });
  renderAt("/admin/online-orders");
  fireEvent.click(await screen.findByRole("button", { name: /WEB-000001/ }));
  await screen.findByText("Order detail o1");
  fireEvent.click(screen.getByRole("link", { name: "Back to orders" }));
  await screen.findByText("Select an order to see its details.");
  expect(scrolledTo).toEqual([420]);
  Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
});

test("a change to an order refreshes the list and the nav badge", async () => {
  renderAt("/admin/online-orders/o1");
  await screen.findByText("Order detail o1");
  await waitFor(() => expect(mockListCalls).toEqual(["needs_action"]));
  mockOnChanged();
  await waitFor(() => expect(mockListCalls).toEqual(["needs_action", "needs_action"]));
  expect(badgeRefreshes).toBe(1);
});
