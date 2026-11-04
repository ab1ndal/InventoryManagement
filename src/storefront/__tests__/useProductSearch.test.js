import { renderHook, waitFor } from "@testing-library/react";
import { useProductSearch } from "../hooks/useProductSearch";

jest.mock("lib/supabaseClient", () => ({ supabase: { from: jest.fn() } }));

const { supabase } = require("lib/supabaseClient");

function mockSearch({ rows, count }) {
  const limits = [];
  const selects = [];
  supabase.from.mockImplementation((table) => {
    if (table === "categories") {
      return { select: () => Promise.resolve({ data: [], error: null }) };
    }
    const builder = {
      select: (...args) => {
        selects.push(args);
        return builder;
      },
      or: () => builder,
      order: () => builder,
      limit: (n) => {
        limits.push(n);
        return Promise.resolve({ data: rows, count, error: null });
      },
    };
    return builder;
  });
  return { limits, selects };
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
