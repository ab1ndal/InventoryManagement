import { guestHolderKey, holderKeyFor, currentHolderKey } from "../lib/holder";
import { supabase } from "lib/supabaseClient";

jest.mock("lib/supabaseClient", () => ({
  supabase: { auth: { getSession: jest.fn() } },
}));

// jsdom has no Web Crypto; the guest holder key needs getRandomValues.
beforeAll(() => {
  Object.defineProperty(window, "crypto", { value: require("crypto").webcrypto, configurable: true });
});

const GUEST_KEY = /^g:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => localStorage.clear());

describe("guestHolderKey", () => {
  it("creates a g:<uuid v4> key once and reuses it", () => {
    const key = guestHolderKey();
    expect(key).toMatch(GUEST_KEY);
    expect(localStorage.getItem("bc_holder")).toBe(key);
    expect(guestHolderKey()).toBe(key);
  });

  it("replaces a malformed stored key", () => {
    localStorage.setItem("bc_holder", "g:not-a-uuid");
    expect(guestHolderKey()).toMatch(GUEST_KEY);
  });

  it("falls back to one in-memory key when storage is unavailable", () => {
    const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      const key = guestHolderKey();
      expect(key).toMatch(GUEST_KEY);
      expect(guestHolderKey()).toBe(key);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("holderKeyFor / currentHolderKey", () => {
  it("keys signed-in shoppers by user id and guests by the guest key", async () => {
    expect(holderKeyFor("u1")).toBe("u:u1");
    expect(holderKeyFor(null)).toMatch(GUEST_KEY);
    supabase.auth.getSession.mockResolvedValue({ data: { session: { user: { id: "u2" } } } });
    expect(await currentHolderKey()).toBe("u:u2");
    supabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await currentHolderKey()).toBe(guestHolderKey());
  });
});
