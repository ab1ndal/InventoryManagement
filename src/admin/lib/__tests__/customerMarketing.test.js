// Plain functions (not jest.fn) because CRA's resetMocks wipes jest.fn
// implementations between tests.
let mockOps = [];
let mockFail = {};

const mockChain = (table) => {
  const op = { table };
  mockOps.push(op);
  const result = () => ({
    data: op.method === "update" ? (op.inArgs?.[1] || []).map((id) => ({ customerid: id })) : null,
    error: mockFail[`${table}.${op.method}`] ? { message: "boom" } : null,
  });
  const chain = {
    insert: (row) => { op.method = "insert"; op.payload = row; return chain; },
    update: (row) => { op.method = "update"; op.payload = row; return chain; },
    eq: (...a) => { op.eqArgs = a; return chain; },
    in: (...a) => { op.inArgs = a; return chain; },
    select: () => chain,
    then: (resolve) => resolve(result()),
  };
  return chain;
};

jest.mock("../../../lib/supabaseClient", () => ({
  supabase: {
    from: (t) => mockChain(t),
    auth: { getUser: async () => ({ data: { user: { id: "admin-uuid" } }, error: null }) },
  },
}));

import { recordMarketingConsent, setCommunityStatus } from "../customerMarketing";

beforeEach(() => {
  mockOps = [];
  mockFail = {};
});

test("opt-in writes the consent log before setting the flag", async () => {
  await recordMarketingConsent({ customerid: 7, optIn: true, source: "counter_form" });
  expect(mockOps.map((o) => `${o.table}.${o.method}`)).toEqual([
    "marketing_consents.insert",
    "customers.update",
  ]);
  expect(mockOps[0].payload).toEqual({
    customerid: 7,
    action: "opt_in",
    source: "counter_form",
    recorded_by: "admin-uuid",
  });
  expect(mockOps[1].payload).toEqual({ marketing_opt_in: true });
  expect(mockOps[1].eqArgs).toEqual(["customerid", 7]);
});

test("opt-out clears the flag before writing the consent log", async () => {
  await recordMarketingConsent({ customerid: 7, optIn: false, source: "counter_form" });
  expect(mockOps.map((o) => `${o.table}.${o.method}`)).toEqual([
    "customers.update",
    "marketing_consents.insert",
  ]);
  expect(mockOps[0].payload).toEqual({ marketing_opt_in: false });
  expect(mockOps[1].payload.action).toBe("opt_out");
});

test("failed opt-in log throws and never sets the flag", async () => {
  mockFail["marketing_consents.insert"] = true;
  await expect(
    recordMarketingConsent({ customerid: 7, optIn: true, source: "counter_form" }),
  ).rejects.toThrow("Could not record WhatsApp consent: boom");
  expect(mockOps.some((o) => o.table === "customers")).toBe(false);
});

test("setCommunityStatus updates all ids in one call and returns updated count", async () => {
  const n = await setCommunityStatus([1, 2, 3], "member");
  expect(n).toBe(3);
  expect(mockOps).toHaveLength(1);
  expect(mockOps[0].inArgs).toEqual(["customerid", [1, 2, 3]]);
  expect(mockOps[0].payload.community_status).toBe("member");
  expect(Number.isNaN(Date.parse(mockOps[0].payload.community_status_at))).toBe(false);
});

test("setCommunityStatus rejects statuses outside the bulk set", async () => {
  await expect(setCommunityStatus([1], "opted_out")).rejects.toThrow("Unsupported");
  expect(mockOps).toHaveLength(0);
});
