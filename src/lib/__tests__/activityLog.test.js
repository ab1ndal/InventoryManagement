import { logActivity } from "../activityLog";
import { supabase } from "../supabaseClient";

jest.mock("../supabaseClient", () => {
  const insert = jest.fn();
  const from = jest.fn(() => ({ insert }));
  return {
    supabase: {
      from,
      auth: { getSession: jest.fn() },
      __insert: insert,
      __from: from,
    },
  };
});

// CRA's Jest config sets resetMocks: true, which clears mock implementations
// before each test. Re-establish them here so each test starts from a known state.
beforeEach(() => {
  supabase.__insert.mockResolvedValue({ error: null });
  supabase.from.mockImplementation(() => ({ insert: supabase.__insert }));
  supabase.auth.getSession.mockResolvedValue({
    data: { session: { user: { id: "u-1" } } },
  });
});

test("inserts a row stamped with the current user id and string entity_id", async () => {
  await logActivity({
    action: "create",
    entityType: "product",
    entityId: 12345,
    summary: "Created product BC25001 — Cotton Kurta",
  });

  expect(supabase.from).toHaveBeenCalledWith("activity_log");
  expect(supabase.__insert).toHaveBeenCalledWith({
    actor_id: "u-1",
    action: "create",
    entity_type: "product",
    entity_id: "12345",
    summary: "Created product BC25001 — Cotton Kurta",
  });
});

test("never throws when the insert fails", async () => {
  supabase.__insert.mockResolvedValueOnce({ error: { message: "boom" } });
  await expect(
    logActivity({ action: "delete", entityType: "bill", entityId: "1042", summary: "x" })
  ).resolves.toBeUndefined();
});
