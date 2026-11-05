jest.mock("lib/supabaseClient", () => ({ supabase: { rpc: jest.fn() } }));

import { supabase } from "lib/supabaseClient";
import {
  FILTER_OPTIONS_TTL_MS,
  clearFilterOptionsCache,
  fetchFilterOptions,
} from "../hooks/filterOptionsCache";

const ok = { data: { categories: [] }, error: null };

beforeEach(() => {
  jest.useFakeTimers();
  clearFilterOptionsCache();
});
afterEach(() => jest.useRealTimers());

describe("fetchFilterOptions", () => {
  test("a second call within the lifetime reuses the first answer", async () => {
    supabase.rpc.mockResolvedValue(ok);
    await fetchFilterOptions();
    jest.advanceTimersByTime(FILTER_OPTIONS_TTL_MS - 1);
    expect(await fetchFilterOptions()).toBe(ok);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("get_shop_filter_options");
  });

  test("the answer expires after ten minutes and is fetched again", async () => {
    supabase.rpc.mockResolvedValue(ok);
    await fetchFilterOptions();
    jest.advanceTimersByTime(FILTER_OPTIONS_TTL_MS);
    await fetchFilterOptions();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  test("a failure is returned but never cached", async () => {
    const failed = { data: null, error: { message: "boom" } };
    supabase.rpc.mockResolvedValueOnce(failed).mockResolvedValueOnce(ok);
    expect(await fetchFilterOptions()).toBe(failed);
    expect(await fetchFilterOptions()).toBe(ok);
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });
});
