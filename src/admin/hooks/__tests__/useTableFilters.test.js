import { renderHook, act } from "@testing-library/react";
import { useTableFilters } from "../useTableFilters";

const INITIAL = { name: "", status: "", page: "" };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("useTableFilters", () => {
  it("initializes filters and debouncedFilters to initial values", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    expect(result.current.filters).toEqual(INITIAL);
    expect(result.current.debouncedFilters).toEqual(INITIAL);
  });

  it("setFilter updates a single field without touching others", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Alice"));
    expect(result.current.filters).toEqual({ name: "Alice", status: "", page: "" });
    expect(result.current.filters.status).toBe("");
  });

  it("debouncedFilters does not update immediately after setFilter", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Alice"));
    expect(result.current.debouncedFilters).toEqual(INITIAL);
  });

  it("debouncedFilters updates after debounce delay", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Alice"));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.debouncedFilters).toEqual({ name: "Alice", status: "", page: "" });
  });

  it("debounce resets if another setFilter fires before delay completes", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Al"));
    act(() => jest.advanceTimersByTime(200));
    act(() => result.current.setFilter("name", "Alice"));
    act(() => jest.advanceTimersByTime(200));
    // total 400ms but second keystroke reset the timer — not committed yet
    expect(result.current.debouncedFilters).toEqual(INITIAL);
    act(() => jest.advanceTimersByTime(100));
    // now 300ms since last keystroke
    expect(result.current.debouncedFilters).toEqual({ name: "Alice", status: "", page: "" });
  });

  it("setFilters replaces the whole filters object", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilters({ name: "Bob", status: "active", page: "2" }));
    expect(result.current.filters).toEqual({ name: "Bob", status: "active", page: "2" });
  });

  it("resetFilters restores all fields to initial values", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Alice"));
    act(() => result.current.setFilter("status", "active"));
    act(() => result.current.resetFilters());
    expect(result.current.filters).toEqual(INITIAL);
  });

  it("resetFilters also resets debouncedFilters after debounce delay", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL));
    act(() => result.current.setFilter("name", "Alice"));
    act(() => jest.advanceTimersByTime(300));
    act(() => result.current.resetFilters());
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.debouncedFilters).toEqual(INITIAL);
  });

  it("respects a custom debounce delay", () => {
    const { result } = renderHook(() => useTableFilters(INITIAL, 500));
    act(() => result.current.setFilter("name", "Alice"));
    act(() => jest.advanceTimersByTime(300));
    expect(result.current.debouncedFilters).toEqual(INITIAL);
    act(() => jest.advanceTimersByTime(200));
    expect(result.current.debouncedFilters).toEqual({ name: "Alice", status: "", page: "" });
  });
});
