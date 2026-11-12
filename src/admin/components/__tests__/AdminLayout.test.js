import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Link, Routes, Route } from "react-router-dom";
import AdminLayout from "../AdminLayout";

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1", email: "staff@example.com" } } } }),
      signOut: async () => ({}),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "admin" } }) }) }) }),
  },
}));
jest.mock("../onlineOrders/onlineOrdersApi", () => ({ countQueue: async () => 3 }));
jest.mock("../../lib/adminAccess", () => ({ lastCheckedRole: () => "admin" }));
jest.mock("../../../components/ui/toaster", () => ({ Toaster: () => null }));

const scrolled = [];

beforeEach(() => {
  scrolled.length = 0;
  // jsdom has no scrollIntoView; record which menu item it was called on.
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this.textContent);
  };
});

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin" element={<AdminLayout />}>
          <Route path="*" element={<Link to="/admin/customers">go</Link>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

test("the active menu item is scrolled into view on load and when the page changes", async () => {
  renderAt("/admin/online-orders");
  await act(async () => {});
  expect(scrolled.at(-1)).toMatch(/^Online Orders/);

  await act(async () => {
    screen.getByText("go").click();
  });
  expect(scrolled.at(-1)).toBe("Customers");
});

test("the user's email is hidden below the xl breakpoint", async () => {
  renderAt("/admin/bills");
  const email = await screen.findByText("staff@example.com");
  expect(email).toHaveClass("hidden", "xl:inline");
  expect(email).not.toHaveClass("sm:inline");
});
