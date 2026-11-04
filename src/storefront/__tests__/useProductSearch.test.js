import { renderHook, waitFor } from "@testing-library/react";
import { useProductSearch } from "../hooks/useProductSearch";

jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));

const { supabase } = require("lib/supabaseClient");

function mockSearch({ rows, count }) {
  const limits = [];
  const selects = [];
  const ors = [];
  const ins = [];
  supabase.from.mockImplementation((table) => {
    if (table === "categories") {
      return {
        select: () => Promise.resolve({ data: [{ categoryid: "SA", name: "Saree" }], error: null }),
      };
    }
    if (table === "colors") {
      return {
        select: () => Promise.resolve({ data: [{ code: "Red", families: ["Red"] }], error: null }),
      };
    }
    const builder = {
      select: (...args) => {
        selects.push(args);
        return builder;
      },
      or: (group) => {
        ors.push(group);
        return builder;
      },
      in: (column, values) => {
        ins.push([column, values]);
        return builder;
      },
      order: () => builder,
      limit: (n) => {
        limits.push(n);
        return Promise.resolve({ data: rows, count, error: null });
      },
    };
    return builder;
  });
  return { limits, selects, ors, ins };
}

test("reports the full number of matches, not just the rows returned", async () => {
  const { limits, selects } = mockSearch({ rows: [{ productid: "BC1" }], count: 89 });
  const { result } = renderHook(() => useProductSearch("saree"));
  await waitFor(() => expect(result.current.total).toBe(89));
  expect(result.current.results).toHaveLength(1);
  expect(limits).toEqual([20]);
  expect(selects[0][1]).toEqual({ count: "exact" });
});

test("a larger limit keeps the current results on screen until it arrives", async () => {
  const { limits } = mockSearch({ rows: [{ productid: "BC1" }], count: 89 });
  const { result, rerender } = renderHook(({ limit }) => useProductSearch("saree", limit), {
    initialProps: { limit: 20 },
  });
  await waitFor(() => expect(result.current.results).toHaveLength(1));

  rerender({ limit: 40 });
  expect(result.current.loading).toBe(true);
  expect(result.current.results).toHaveLength(1);
  await waitFor(() => expect(limits).toEqual([20, 40]));
});

test("every word must match: one filter group per text word, colour as a variant filter", async () => {
  const { ors, ins, selects } = mockSearch({ rows: [{ productid: "BC1" }], count: 1 });
  const { result } = renderHook(() => useProductSearch("red sari wedding"));
  await waitFor(() => expect(result.current.total).toBe(1));
  expect(ors).toHaveLength(2);
  expect(ors[0]).toContain("categoryid.in.(SA)");
  expect(ors[1]).toContain("description.ilike.%wedding%");
  expect(ins).toEqual([["colour0.color", ["Red"]]]);
  expect(selects[0][0]).toContain("colour0:productsizecolors!inner(productid)");
  expect(selects[0][0]).not.toMatch(/cost/i);
});

test("a slow older search cannot overwrite a newer one", async () => {
  const resolvers = {};
  supabase.from.mockImplementation((table) => {
    if (table === "categories" || table === "colors") {
      return { select: () => Promise.resolve({ data: [], error: null }) };
    }
    const builder = {
      select: () => builder,
      or: (group) => {
        builder.group = group;
        return builder;
      },
      in: () => builder,
      order: () => builder,
      limit: () =>
        new Promise((resolve) => {
          resolvers[builder.group] = resolve;
        }),
    };
    return builder;
  });
  const { result, rerender } = renderHook(({ q }) => useProductSearch(q), {
    initialProps: { q: "silk" },
  });
  await waitFor(() => expect(Object.keys(resolvers)).toHaveLength(1));
  rerender({ q: "cotton" });
  await waitFor(() => expect(Object.keys(resolvers)).toHaveLength(2));
  const [oldKey, newKey] = Object.keys(resolvers);
  resolvers[newKey]({ data: [{ productid: "NEW" }], count: 1 });
  await waitFor(() => expect(result.current.results[0]?.productid).toBe("NEW"));
  resolvers[oldKey]({ data: [{ productid: "OLD" }], count: 1 });
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.results[0].productid).toBe("NEW");
});
