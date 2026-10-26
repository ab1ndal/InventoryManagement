import React from "react";
import { render, screen, act } from "@testing-library/react";
import { WishlistProvider, useWishlist } from "../context/WishlistContext";
import { fetchServerWishlist, addServerItems, removeServerItem } from "../lib/wishlistApi";

jest.mock("../lib/wishlistApi", () => {
  const actual = jest.requireActual("../lib/wishlistApi");
  return {
    isMissingTableError: actual.isMissingTableError,
    fetchServerWishlist: jest.fn(async () => []),
    addServerItems: jest.fn(async () => {}),
    removeServerItem: jest.fn(async () => {}),
  };
});
let authCb;
jest.mock("lib/supabaseClient", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb) => {
        authCb = cb;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));


const SAREE = { productid: "BC1", name: "Saree", retailprice: 1000 };
const KURTA = { productid: "BC2", name: "Kurta", retailprice: 800 };
const SESSION = { user: { id: "u1" } };

function Probe() {
  const { toggle, remove, has, count, items } = useWishlist();
  return (
    <>
      <span data-testid="count">{count}</span>
      <span data-testid="has">{has("BC1") ? "yes" : "no"}</span>
      <span data-testid="ids">{items.map((i) => i.productid).join(",")}</span>
      <button onClick={() => toggle({ ...SAREE, extra: "ignored" })}>t</button>
      <button onClick={() => remove("BC1")}>r</button>
    </>
  );
}

const renderProbe = () => render(<WishlistProvider><Probe /></WishlistProvider>);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const fire = async (event, session) => {
  await act(async () => { authCb(event, session); });
  await flush();
};
const stored = () => JSON.parse(localStorage.getItem("bc_wishlist"));

let errorSpy;
let warnSpy;
beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  fetchServerWishlist.mockResolvedValue([]);
  addServerItems.mockResolvedValue(undefined);
  removeServerItem.mockResolvedValue(undefined);
  errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("guest", () => {
  it("toggles items and persists the snapshot to localStorage", () => {
    renderProbe();
    act(() => screen.getByText("t").click());
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(screen.getByTestId("has").textContent).toBe("yes");
    expect(stored()).toEqual([SAREE]);
    act(() => screen.getByText("t").click());
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(addServerItems).not.toHaveBeenCalled();
    expect(removeServerItem).not.toHaveBeenCalled();
  });

  it("keeps the guest list when INITIAL_SESSION fires with no session", async () => {
    localStorage.setItem("bc_wishlist", JSON.stringify([SAREE]));
    renderProbe();
    await fire("INITIAL_SESSION", null);
    expect(screen.getByTestId("count").textContent).toBe("1");
    expect(fetchServerWishlist).not.toHaveBeenCalled();
  });
});

describe("sign-in sync", () => {
  it("returns synchronously from the auth callback (no auth-lock deadlock)", async () => {
    fetchServerWishlist.mockReturnValue(new Promise(() => {}));
    renderProbe();
    let ret;
    await act(async () => { ret = authCb("SIGNED_IN", SESSION); });
    expect(ret).toBeUndefined();
  });

  it("merges guest items into the server list and uploads only the guest-only ones", async () => {
    localStorage.setItem("bc_wishlist", JSON.stringify([SAREE]));
    fetchServerWishlist.mockResolvedValue([KURTA]);
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    expect(screen.getByTestId("ids").textContent).toBe("BC2,BC1");
    expect(addServerItems).toHaveBeenCalledWith("u1", ["BC1"]);
    expect(stored()).toEqual([KURTA, SAREE]);
  });

  it("merges a pre-existing local list on session restore the first time (rollout)", async () => {
    localStorage.setItem("bc_wishlist", JSON.stringify([SAREE]));
    renderProbe();
    await fire("INITIAL_SESSION", SESSION);
    expect(screen.getByTestId("ids").textContent).toBe("BC1");
    expect(addServerItems).toHaveBeenCalledWith("u1", ["BC1"]);
  });

  it("treats the server as truth once the local list is already synced for this user", async () => {
    localStorage.setItem("bc_wishlist", JSON.stringify([SAREE]));
    renderProbe();
    await fire("SIGNED_IN", SESSION); // BC1 now synced for u1
    // Removed on another device:
    fetchServerWishlist.mockResolvedValue([KURTA]);
    addServerItems.mockClear();
    await fire("INITIAL_SESSION", SESSION);
    expect(screen.getByTestId("ids").textContent).toBe("BC2");
    expect(addServerItems).not.toHaveBeenCalled();
  });

  it("drops a pending sync when the provider unmounts", async () => {
    const { unmount } = renderProbe();
    // Synchronous act: an async act can yield long enough under load for the
    // deferred sync timer to fire before unmount, making this test flaky.
    act(() => { authCb("SIGNED_IN", SESSION); });
    unmount();
    await flush();
    expect(fetchServerWishlist).not.toHaveBeenCalled();
    expect(localStorage.getItem("bc_wishlist_owner")).toBeNull();
  });

  it("clears the list on SIGNED_OUT", async () => {
    fetchServerWishlist.mockResolvedValue([KURTA]);
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    await fire("SIGNED_OUT", null);
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(stored()).toEqual([]);
  });
});

describe("signed-in writes", () => {
  it("writes toggles to the server", async () => {
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    act(() => screen.getByText("t").click());
    await flush();
    expect(addServerItems).toHaveBeenCalledWith("u1", ["BC1"]);
    act(() => screen.getByText("t").click());
    await flush();
    expect(removeServerItem).toHaveBeenCalledWith("u1", "BC1");
    expect(screen.getByTestId("count").textContent).toBe("0");
  });

  it("reverts an add that the server rejects and logs it", async () => {
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    addServerItems.mockRejectedValueOnce({ code: "42501", message: "denied" });
    act(() => screen.getByText("t").click());
    expect(screen.getByTestId("has").textContent).toBe("yes"); // optimistic
    await flush();
    expect(screen.getByTestId("has").textContent).toBe("no");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("reverts a remove that the server rejects", async () => {
    fetchServerWishlist.mockResolvedValue([SAREE]);
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    removeServerItem.mockRejectedValueOnce(new Error("offline"));
    act(() => screen.getByText("r").click());
    expect(screen.getByTestId("has").textContent).toBe("no");
    await flush();
    expect(screen.getByTestId("has").textContent).toBe("yes");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("table not migrated yet", () => {
  it.each(["PGRST205", "42P01"])(
    "falls back to local-only on %s, warns once, and keeps the list on sign-out",
    async (code) => {
      localStorage.setItem("bc_wishlist", JSON.stringify([SAREE]));
      fetchServerWishlist.mockRejectedValue({ code, message: "missing" });
      renderProbe();
      await fire("SIGNED_IN", SESSION);
      expect(screen.getByTestId("ids").textContent).toBe("BC1");

      // Later toggles stay local; no further server calls or warnings.
      await fire("TOKEN_REFRESHED", SESSION);
      act(() => screen.getByText("t").click());
      await flush();
      expect(screen.getByTestId("count").textContent).toBe("0");
      expect(fetchServerWishlist).toHaveBeenCalledTimes(1);
      expect(removeServerItem).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();

      act(() => screen.getByText("t").click());
      await fire("SIGNED_OUT", null);
      expect(screen.getByTestId("ids").textContent).toBe("BC1");
    }
  );

  it("falls back to local-only when a write hits the missing table, without reverting", async () => {
    renderProbe();
    await fire("SIGNED_IN", SESSION);
    addServerItems.mockRejectedValueOnce({ code: "PGRST205" });
    act(() => screen.getByText("t").click());
    await flush();
    expect(screen.getByTestId("has").textContent).toBe("yes");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
