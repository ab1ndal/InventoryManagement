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
import { upsertItem } from "../lib/cartApi";

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
