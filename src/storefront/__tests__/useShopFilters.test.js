import { renderHook, waitFor, act } from "@testing-library/react";
import useShopFilters from "../hooks/useShopFilters";

jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const { supabase } = require("lib/supabaseClient");

// Each products query parks on a deferred promise so the test decides the
// order in which responses arrive.
let pending;

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

function product(id) {
  return { productid: id, name: id, retailprice: 1000, productsizecolors: [] };
}

function respond(index, ids) {
  return act(async () => {
    pending[index].resolve({ data: ids.map(product), count: ids.length, error: null });
  });
}

beforeEach(() => {
  pending = [];
  // Filter vocabularies and availability are irrelevant here.
  supabase.rpc.mockResolvedValue({ data: null, error: null });
  supabase.from.mockImplementation(() => {
    const builder = {
      select: () => builder,
      in: () => builder,
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: () => {
        const d = deferred();
        pending.push(d);
        return d.promise;
      },
    };
    return builder;
  });
});

test("a slower response for older filters does not overwrite newer results", async () => {
  const { result } = renderHook(() => useShopFilters());
  await waitFor(() => expect(pending).toHaveLength(1));

  act(() => result.current.toggle("categories", "SA"));
  await waitFor(() => expect(pending).toHaveLength(2));

  await respond(1, ["SAREE"]);
  await respond(0, ["STALE"]);

  expect(result.current.products.map((p) => p.productid)).toEqual(["SAREE"]);
  expect(result.current.totalCount).toBe(1);
  expect(result.current.loading).toBe(false);
});

test("a next page for older filters is not appended to newer results", async () => {
  const { result } = renderHook(() => useShopFilters());
  await waitFor(() => expect(pending).toHaveLength(1));

  const firstPage = Array.from({ length: 24 }, (_, i) => `P${i}`);
  await respond(0, firstPage);
  expect(result.current.hasMore).toBe(true);

  act(() => result.current.fetchNextPage());
  await waitFor(() => expect(pending).toHaveLength(2));

  act(() => result.current.toggle("categories", "SA"));
  await waitFor(() => expect(pending).toHaveLength(3));

  await respond(2, ["SAREE"]);
  await respond(1, ["OLD-PAGE-2"]);

  expect(result.current.products.map((p) => p.productid)).toEqual(["SAREE"]);
  expect(result.current.loadingMore).toBe(false);
});
