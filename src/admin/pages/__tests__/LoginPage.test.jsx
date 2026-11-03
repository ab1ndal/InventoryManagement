import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import LoginPage from "../LoginPage";
import { OAUTH_PENDING_KEY } from "../../lib/adminAccess";

let mockProfile;
let mockSignIn;
const mockSignOut = jest.fn();
const mockOAuth = jest.fn();
const mockToast = jest.fn();
const mockRpc = jest.fn();

jest.mock("sonner", () => ({ toast: (...args) => mockToast(...args) }));
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    auth: {
      signInWithPassword: () => mockSignIn(),
      signInWithOAuth: (args) => mockOAuth(args),
      signOut: () => mockSignOut(),
    },
    rpc: (...args) => mockRpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve(mockProfile) }) }),
    }),
  },
}));

function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/admin/login"]}>
      <Routes>
        <Route path="/admin/login" element={<LoginPage />} />
        <Route path="/admin/inventory" element={<p>inventory page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function submit() {
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "a@b.test" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "pw" } });
  fireEvent.click(screen.getByRole("button", { name: "Login with Email" }));
}

beforeEach(() => {
  sessionStorage.clear();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ error: null });
  mockToast.mockReset();
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue({});
  mockOAuth.mockReset();
  mockSignIn = () => Promise.resolve({ data: { user: { id: "u1" } }, error: null });
  mockProfile = { data: { role: "admin", is_active: true }, error: null };
});

test("an admin logs in", async () => {
  renderLogin();
  submit();
  expect(await screen.findByText("inventory page")).toBeInTheDocument();
  expect(mockSignOut).not.toHaveBeenCalled();
});

test.each([
  ["customer", { data: { role: "user", is_active: true }, error: null }],
  ["deactivated admin", { data: { role: "admin", is_active: false }, error: null }],
])("a %s with the right password is signed out and stays on login", async (_who, profile) => {
  mockProfile = profile;
  renderLogin();
  submit();
  await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Login Failed", expect.objectContaining({ description: "This account does not have admin access." }))
  );
  expect(screen.queryByText("inventory page")).not.toBeInTheDocument();
});

test("a wrong password shows the auth error and does not check the profile", async () => {
  mockSignIn = () => Promise.resolve({ data: { user: null }, error: { message: "Invalid login credentials" } });
  renderLogin();
  submit();
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Login Failed", expect.objectContaining({ description: "Invalid login credentials" }))
  );
  expect(mockSignOut).not.toHaveBeenCalled();
});

test("Google marks the attempt so the guard can refuse a non-admin", async () => {
  mockOAuth.mockResolvedValue({ error: null });
  renderLogin();
  fireEvent.click(screen.getByRole("button", { name: /Sign in with Google/ }));
  await waitFor(() => expect(mockOAuth).toHaveBeenCalled());
  expect(sessionStorage.getItem(OAUTH_PENDING_KEY)).toBe("1");
});

test("no sign up link", () => {
  renderLogin();
  expect(screen.queryByText("Sign up")).not.toBeInTheDocument();
});
