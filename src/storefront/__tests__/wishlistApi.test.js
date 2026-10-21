jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));

import { supabase } from "lib/supabaseClient";
import {
  fetchServerWishlist, addServerItems, removeServerItem, isMissingTableError,
} from "../lib/wishlistApi";

describe("wishlistApi.fetchServerWishlist", () => {
  it("reads rows joined to products in one query and returns the snapshot shape", async () => {
    const order = jest.fn(async () => ({
      data: [
        { product_id: "BC1", products: { productid: "BC1", name: "Silk Saree", retailprice: "1000" } },
        { product_id: "BC2", products: null }, // hidden by products RLS
      ],
      error: null,
    }));
    const select = jest.fn(() => ({ order }));
    supabase.from.mockReturnValue({ select });

    const items = await fetchServerWishlist();

    expect(supabase.from).toHaveBeenCalledWith("wishlist_items");
    expect(select).toHaveBeenCalledWith("product_id, products(productid, name, retailprice)");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(items).toEqual([{ productid: "BC1", name: "Silk Saree", retailprice: 1000 }]);
  });

  it("throws the PostgREST error so callers can detect a missing table", async () => {
    const err = { code: "PGRST205", message: "Could not find the table" };
    supabase.from.mockReturnValue({ select: () => ({ order: async () => ({ data: null, error: err }) }) });
    await expect(fetchServerWishlist()).rejects.toBe(err);
  });
});

describe("wishlistApi writes", () => {
  it("adds many products in one upsert that ignores existing pairs", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    supabase.from.mockReturnValue({ upsert });
    await addServerItems("u1", ["BC1", "BC2"]);
    expect(upsert).toHaveBeenCalledWith(
      [{ user_id: "u1", product_id: "BC1" }, { user_id: "u1", product_id: "BC2" }],
      { onConflict: "user_id,product_id", ignoreDuplicates: true }
    );
  });

  it("skips the request when there is nothing to add", async () => {
    supabase.from.mockClear();
    await addServerItems("u1", []);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("deletes one product for the user and throws on error", async () => {
    const err = { code: "42501" };
    const eq2 = jest.fn(async () => ({ error: err }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    supabase.from.mockReturnValue({ delete: () => ({ eq: eq1 }) });
    await expect(removeServerItem("u1", "BC1")).rejects.toBe(err);
    expect(eq1).toHaveBeenCalledWith("user_id", "u1");
    expect(eq2).toHaveBeenCalledWith("product_id", "BC1");
  });
});

describe("isMissingTableError", () => {
  it("recognises Postgres and PostgREST missing-table codes only", () => {
    expect(isMissingTableError({ code: "42P01" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST205" })).toBe(true);
    expect(isMissingTableError({ code: "42501" })).toBe(false);
    expect(isMissingTableError(new Error("network"))).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});
