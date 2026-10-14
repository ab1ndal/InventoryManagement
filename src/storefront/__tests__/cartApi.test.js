jest.mock("lib/supabaseClient", () => {
  const getUser = jest.fn();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  const auth = { getUser };
  const api = { auth, _table: null, from: jest.fn() };
  return { supabase: api };
});
jest.mock("../lib/productImage", () => ({
  getProductImageUrl: jest.fn(async () => "img://x"),
}));

import { supabase } from "lib/supabaseClient";
import { upsertItem, fetchLiveVariantData } from "../lib/cartApi";

describe("cartApi.upsertItem", () => {
  beforeEach(() => {
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("upserts with the current user id on the (user_id,variant_id) conflict", async () => {
    const upsert = jest.fn(async () => ({ error: null }));
    supabase.from.mockReturnValue({ upsert });
    await upsertItem({ variant_id: "v1", product_id: "BC1", quantity: 3 });
    expect(supabase.from).toHaveBeenCalledWith("cart_items");
    expect(upsert).toHaveBeenCalledWith(
      { user_id: "u1", variant_id: "v1", product_id: "BC1", quantity: 3 },
      { onConflict: "user_id,variant_id" }
    );
  });
});

describe("cartApi.fetchLiveVariantData", () => {
  function mockTables({ variants, products }) {
    supabase.from.mockImplementation((table) => ({
      select: () => ({
        in: async () => ({ data: table === "products" ? products : variants, error: null }),
      }),
    }));
  }

  it("returns live stock and price per variant", async () => {
    mockTables({
      variants: [{ variantid: "v1", stock: 4 }],
      products: [{ productid: "BC1", retailprice: "1500" }],
    });
    const live = await fetchLiveVariantData([{ variant_id: "v1", product_id: "BC1", quantity: 1 }]);
    expect(live).toEqual({ v1: { stock: 4, price: 1500 } });
  });

  it("omits variants whose product is no longer visible on the storefront", async () => {
    mockTables({
      variants: [{ variantid: "v1", stock: 4 }, { variantid: "v2", stock: 2 }],
      products: [{ productid: "BC1", retailprice: "1500" }],
    });
    const live = await fetchLiveVariantData([
      { variant_id: "v1", product_id: "BC1", quantity: 1 },
      { variant_id: "v2", product_id: "BC2", quantity: 1 },
    ]);
    expect(live).toEqual({ v1: { stock: 4, price: 1500 } });
  });
});
