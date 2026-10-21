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

test("a category scope limits queries until the shopper picks a category", async () => {
  const inCalls = [];
  supabase.from.mockImplementation(() => {
    const builder = {
      select: () => builder,
      in: (column, values) => {
        inCalls.push([column, values]);
        return builder;
      },
      gte: () => builder,
      lte: () => builder,
      order: () => builder,
      range: () => Promise.resolve({ data: [], count: 0, error: null }),
    };
    return builder;
  });
  supabase.rpc.mockImplementation((name) =>
    Promise.resolve(
      name === "get_shop_filter_options"
        ? {
            data: {
              categories: [
                { categoryid: "ST", name: "Suits" },
                { categoryid: "RMS", name: "Readymade Suits" },
                { categoryid: "SA", name: "Saree" },
              ],
            },
            error: null,
          }
        : { data: null, error: null }
    )
  );
  const scope = ["ST", "RMS"];
  const { result } = renderHook(() => useShopFilters({ scopeCategoryIds: scope }));

  await waitFor(() => expect(inCalls).toContainEqual(["categoryid", scope]));
  await waitFor(() =>
    expect(result.current.categoryOptions.map((c) => c.categoryid)).toEqual(["ST", "RMS"])
  );
  expect(supabase.rpc).toHaveBeenCalledWith(
    "get_shop_available_options",
    expect.objectContaining({ p_categories: scope })
  );

  act(() => result.current.toggle("categories", "RMS"));
  await waitFor(() => expect(inCalls).toContainEqual(["categoryid", ["RMS"]]));
});

test("a single-category scope hides the category filter", async () => {
  supabase.rpc.mockImplementation((name) =>
    Promise.resolve(
      name === "get_shop_filter_options"
        ? { data: { categories: [{ categoryid: "LE", name: "Lehenga" }, { categoryid: "SA", name: "Saree" }] }, error: null }
        : { data: null, error: null }
    )
  );
  const scope = ["LE"];
  const { result } = renderHook(() => useShopFilters({ scopeCategoryIds: scope }));
  await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("get_shop_filter_options"));
  await waitFor(() => expect(result.current.categoryOptions).toEqual([]));
});

describe("product-id scope (curated collections)", () => {
  // Thenable builder: records every call and resolves with `resolve(calls)`.
  function mockProducts(resolve) {
    const queries = [];
    supabase.from.mockImplementation(() => {
      const calls = [];
      queries.push(calls);
      const builder = {};
      ["select", "in", "gte", "lte", "order", "range"].forEach((m) => {
        builder[m] = (...a) => {
          calls.push([m, ...a]);
          return builder;
        };
      });
      builder.then = (onOk, onErr) => Promise.resolve(resolve(calls)).then(onOk, onErr);
      return builder;
    });
    return queries;
  }

  const IDS = Array.from({ length: 30 }, (_, i) => `BC${100 + i}`);
  // The database returns rows in its own order, not the curated one.
  const ROWS = [...IDS].reverse().map((id, i) => ({
    productid: id,
    name: id,
    retailprice: 1000 + i,
    categoryid: i % 2 ? "SA" : "LE",
    fabric: "KATAN",
    productsizecolors: [{ stock: 1, color: i % 2 ? "RED" : "NAVY", size: "FREE" }],
  }));
  const isOptionsQuery = (calls) => calls[0][1].includes("productsizecolors(color, size)");

  beforeEach(() => {
    supabase.rpc.mockImplementation((name) =>
      Promise.resolve(
        name === "get_shop_filter_options"
          ? {
              data: {
                categories: [
                  { categoryid: "LE", name: "Lehenga" },
                  { categoryid: "SA", name: "Saree" },
                  { categoryid: "ST", name: "Suits" },
                ],
                colors: [
                  { code: "RED", families: ["Red"] },
                  { code: "NAVY", families: ["Blue"] },
                ],
              },
              error: null,
            }
          : { data: null, error: null }
      )
    );
  });

  test("defaults to the curated order and pages through it", async () => {
    const queries = mockProducts((calls) =>
      isOptionsQuery(calls) ? { data: ROWS, error: null } : { data: ROWS, count: ROWS.length, error: null }
    );
    const { result } = renderHook(() => useShopFilters({ scopeProductIds: IDS }));

    expect(result.current.sortBy).toBe("featured");
    expect(result.current.sortOptions.map((o) => o.value)).toEqual([
      "featured",
      "newest",
      "price_asc",
      "price_desc",
    ]);
    await waitFor(() => expect(result.current.products).toHaveLength(24));
    expect(result.current.products.map((p) => p.productid)).toEqual(IDS.slice(0, 24));
    expect(result.current.totalCount).toBe(30);
    expect(result.current.hasMore).toBe(true);

    const listQuery = queries.find((c) => !isOptionsQuery(c));
    expect(listQuery).toContainEqual(["in", "productid", IDS]);
    expect(listQuery.some(([m]) => m === "range")).toBe(false);

    act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.products).toHaveLength(30));
    expect(result.current.products.map((p) => p.productid)).toEqual(IDS);
    expect(result.current.hasMore).toBe(false);
  });

  test("other sorts still order and page in the database", async () => {
    const queries = mockProducts((calls) =>
      isOptionsQuery(calls) ? { data: ROWS, error: null } : { data: [], count: 0, error: null }
    );
    const { result } = renderHook(() => useShopFilters({ scopeProductIds: IDS }));
    act(() => result.current.setSortBy("price_asc"));
    await waitFor(() =>
      expect(queries.some((c) => c.some(([m, col]) => m === "order" && col === "retailprice"))).toBe(true)
    );
    const priced = queries.find((c) => c.some(([m, col]) => m === "order" && col === "retailprice"));
    expect(priced).toContainEqual(["in", "productid", IDS]);
    expect(priced).toContainEqual(["range", 0, 23]);
  });

  test("filter options come from the scoped products, not the shop-wide RPC", async () => {
    mockProducts((calls) =>
      isOptionsQuery(calls) ? { data: ROWS, error: null } : { data: [], count: 0, error: null }
    );
    const { result } = renderHook(() => useShopFilters({ scopeProductIds: IDS }));

    await waitFor(() =>
      expect(result.current.categoryOptions.map((c) => c.categoryid)).toEqual(["LE", "SA"])
    );
    await waitFor(() => expect(result.current.baseOptions).not.toBeNull());
    expect(result.current.baseOptions.colors).toEqual(new Set(["Red", "Blue"]));

    act(() => result.current.toggle("colors", "Red"));
    await waitFor(() => expect(result.current.availableOptions).not.toBeNull());
    expect(result.current.availableOptions.categories).toEqual(new Set(["SA"]));
    expect(supabase.rpc).not.toHaveBeenCalledWith("get_shop_available_options", expect.anything());
  });

  test("rejects a product list too large to load client-side", () => {
    const tooMany = Array.from({ length: 201 }, (_, i) => `BC${i}`);
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useShopFilters({ scopeProductIds: tooMany }))).toThrow(/at most 200/);
    console.error.mockRestore();
  });
});

describe("size options", () => {
  // distinct_sizes covers variants of every product; only XS and XL belong to
  // products the storefront shows (the shop-wide availability RPC's sizes).
  const filterOptions = {
    sizes: [
      { code: "XS|34", label: "XS|34", sort_order: 1 },
      { code: "S|36", label: "S|36", sort_order: 2 },
      { code: "XL|42", label: "XL|42", sort_order: 5 },
      { code: "28", label: "28 (Waist)", sort_order: 9 },
    ],
    distinct_sizes: ["XL|42", "28", "S|36", "XS|34"],
  };

  function mockRpc(availability) {
    supabase.rpc.mockImplementation((name) =>
      name === "get_shop_filter_options"
        ? Promise.resolve({ data: filterOptions, error: null })
        : availability.promise
    );
  }

  test("lists only sizes a shop product has, never the raw variant sizes first", async () => {
    const availability = deferred();
    mockRpc(availability);
    const { result } = renderHook(() => useShopFilters());

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith("get_shop_available_options", expect.anything())
    );
    // Before availability lands, no size outside the shop's products is offered.
    expect(result.current.sizeOptions).toEqual([]);

    await act(async () => {
      availability.resolve({ data: { sizes: ["XL|42", "XS|34"] }, error: null });
    });
    await waitFor(() => expect(result.current.sizeOptions).toEqual(["XS|34", "XL|42"]));
  });

  test("falls back to every variant size when availability fails", async () => {
    const availability = deferred();
    mockRpc(availability);
    const { result } = renderHook(() => useShopFilters());
    jest.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      availability.resolve({ data: null, error: { message: "boom" } });
    });
    await waitFor(() =>
      expect(result.current.sizeOptions).toEqual(["XS|34", "S|36", "XL|42", "28"])
    );
    console.error.mockRestore();
  });
});
