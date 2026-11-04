import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import RequireAdminAuth from "../RequireAdminAuth";
import { OAUTH_PENDING_KEY } from "../../lib/adminAccess";

let mockSession;
let mockProfile;
let mockAuthListener;
const mockSignOut = jest.fn();

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: mockSession } }),
      onAuthStateChange: (cb) => {
        mockAuthListener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: () => mockSignOut(),
    },
    rpc: () => Promise.resolve({ error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(mockProfile) }) }),
    }),
  },
}));

const USER = { user: { id: "u1" } };

function renderGuard(allowedRoles) {
  return render(
    <MemoryRouter initialEntries={["/admin/inventory"]}>
      <Routes>
        <Route path="/admin/login" element={<p>login page</p>} />
        <Route path="/unauthorized" element={<p>unauthorized page</p>} />
        <Route element={<RequireAdminAuth allowedRoles={allowedRoles} />}>
          <Route path="/admin/inventory" element={<p>secret page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue({});
  mockSession = USER;
  mockProfile = { data: { role: "admin", is_active: true }, error: null };
});

test("an active admin gets in", async () => {
  renderGuard();
  expect(await screen.findByText("secret page")).toBeInTheDocument();
});

test.each([
  ["customer", { data: { role: "user", is_active: true }, error: null }],
  ["deactivated admin", { data: { role: "admin", is_active: false }, error: null }],
  ["failed check", { data: null, error: { message: "down" } }],
])("%s is refused, and their shop session is left alone", async (_who, profile) => {
  jest.spyOn(console, "warn").mockImplementation(() => {});
  mockProfile = profile;
  renderGuard();
  expect(await screen.findByText("unauthorized page")).toBeInTheDocument();
  expect(screen.queryByText("secret page")).not.toBeInTheDocument();
  expect(mockSignOut).not.toHaveBeenCalled();
});

test("a non-admin returning from Google is signed out with a message", async () => {
  sessionStorage.setItem(OAUTH_PENDING_KEY, "1");
  mockProfile = { data: { role: "user", is_active: false }, error: null };
  renderGuard();
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  expect(sessionStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
  expect(JSON.parse(sessionStorage.getItem("toastData")).description).toMatch(/does not have admin access/);
  expect(screen.queryByText("secret page")).not.toBeInTheDocument();
});

test("an admin returning from Google stays in", async () => {
  sessionStorage.setItem(OAUTH_PENDING_KEY, "1");
  renderGuard();
  expect(await screen.findByText("secret page")).toBeInTheDocument();
  expect(mockSignOut).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(OAUTH_PENDING_KEY)).toBeNull();
});

test("signing out removes access straight away", async () => {
  renderGuard();
  await screen.findByText("secret page");
  act(() => mockAuthListener("SIGNED_OUT", null));
  expect(await screen.findByText("login page")).toBeInTheDocument();
});

test("a role removed mid-session removes access at the next auth event", async () => {
  renderGuard();
  await screen.findByText("secret page");
  mockProfile = { data: { role: "user", is_active: true }, error: null };
  await act(async () => mockAuthListener("TOKEN_REFRESHED", USER));
  expect(await screen.findByText("unauthorized page")).toBeInTheDocument();
});

test("a superadmin page refuses a plain admin", async () => {
  renderGuard(["superadmin"]);
  expect(await screen.findByText("unauthorized page")).toBeInTheDocument();
});
