import { renderHook, waitFor } from "@testing-library/react";
import { useProduct } from "../hooks/useProduct";

jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = require("lib/supabaseClient");

const MOCK_PRODUCT = {
  productid: "BC25001",
  name: "Silk Kurta",
  retailprice: 3500,
  fabric: "Silk",
  producturl: null,
  image_url: null,
  categories: { name: "Kurtas" },
};

const MOCK_VARIANTS = [
  { id: "v1", size: "S", color: "Red", stock: 2 },
  { id: "v2", size: "S", color: "Blue", stock: 0 },
  { id: "v3", size: "M", color: "Red", stock: 1 },
];

function mockSuccess() {
  supabase.from.mockImplementation((table) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: MOCK_PRODUCT, error: null }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: MOCK_VARIANTS, error: null }),
          }),
        }),
      }),
    };
  });
}

function mockProductError() {
  supabase.from.mockImplementation((table) => {
    if (table === "products") {
      return {
        select: () => ({
          eq: () => ({
            single: () =>
              Promise.resolve({ data: null, error: { message: "Not found" } }),
          }),
        }),
      };
    }
    return {
      select: () => ({
        eq: () => ({
          order: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    };
  });
}

beforeEach(() => jest.clearAllMocks());

describe("useProduct", () => {
  it("starts in loading state", () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("BC25001"));
    expect(result.current.loading).toBe(true);
    expect(result.current.product).toBeNull();
    expect(result.current.variants).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns product and variants on success", async () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("BC25001"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.product).toEqual(MOCK_PRODUCT);
    expect(result.current.variants).toEqual(MOCK_VARIANTS);
    expect(result.current.error).toBeNull();
  });

  it("returns error when product fetch fails", async () => {
    mockProductError();
    const { result } = renderHook(() => useProduct("BC25001"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toEqual({ message: "Not found" });
    expect(result.current.product).toBeNull();
  });

  it("does nothing when productId is undefined", () => {
    const { result } = renderHook(() => useProduct(undefined));
    expect(result.current.loading).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
