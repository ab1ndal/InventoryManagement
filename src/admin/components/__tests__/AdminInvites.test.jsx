import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminInvites from "../AdminInvites";

let mockRows;
const mockInsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockToast = jest.fn();

jest.mock("../../../components/hooks/use-toast", () => ({ toast: (...a) => mockToast(...a) }));
jest.mock("../../../lib/activityLog", () => ({ logActivity: jest.fn() }));
jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => Promise.resolve({ data: mockRows, error: null }) }),
      insert: (row) => mockInsert(row),
      delete: () => ({ eq: (col, val) => mockDeleteEq(col, val) }),
    }),
  },
}));

function add(email) {
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  mockRows = [];
  mockToast.mockReset();
  mockInsert.mockReset();
  mockInsert.mockResolvedValue({ error: null });
  mockDeleteEq.mockReset();
  mockDeleteEq.mockResolvedValue({ error: null });
});

afterEach(() => jest.restoreAllMocks());

it("saves the email in the form the sign-in check compares against", async () => {
  render(<AdminInvites />);
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "superadmin" } });
  add("  New.Staff@Example.COM ");
  await waitFor(() => expect(mockInsert).toHaveBeenCalledWith({ email: "new.staff@example.com", role: "superadmin" }));
});

it("explains a repeat invite", async () => {
  mockInsert.mockResolvedValue({ error: { code: "23505", message: "dup" } });
  render(<AdminInvites />);
  add("a@b.test");
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: "That email is already pending." }))
  );
});

it("lists pending invites and removes one", async () => {
  mockRows = [{ email: "a@b.test", role: "admin" }];
  render(<AdminInvites />);
  expect(await screen.findByText(/a@b\.test · Admin/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(mockDeleteEq).toHaveBeenCalledWith("email", "a@b.test"));
  await waitFor(() => expect(screen.queryByText(/a@b\.test/)).not.toBeInTheDocument());
});
