import { hasAdminAccess } from "../adminAccess";

function clientWith({ claimError = null, profile }) {
  const calls = [];
  return {
    calls,
    rpc: (name) => {
      calls.push(name);
      return Promise.resolve({ error: claimError });
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => {
            calls.push("profile");
            return Promise.resolve(profile);
          },
        }),
      }),
    }),
  };
}

describe("hasAdminAccess", () => {
  beforeEach(() => jest.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it("claims a pending invite before reading the role, so a first sign-in gets in", async () => {
    const client = clientWith({ profile: { data: { role: "admin", is_active: true }, error: null } });
    await expect(hasAdminAccess(client, "u1")).resolves.toBe(true);
    expect(client.calls).toEqual(["claim_admin_invite", "profile"]);
  });

  it("refuses a customer with no invite", async () => {
    const client = clientWith({ profile: { data: { role: "user", is_active: true }, error: null } });
    await expect(hasAdminAccess(client, "u1")).resolves.toBe(false);
  });

  it("still lets an existing admin in when the claim call fails", async () => {
    const client = clientWith({
      claimError: { message: "down" },
      profile: { data: { role: "admin", is_active: true }, error: null },
    });
    await expect(hasAdminAccess(client, "u1")).resolves.toBe(true);
  });

  it("refuses when the claim and the profile read both fail", async () => {
    const client = clientWith({
      claimError: { message: "down" },
      profile: { data: null, error: { message: "down" } },
    });
    await expect(hasAdminAccess(client, "u1")).resolves.toBe(false);
  });
});
