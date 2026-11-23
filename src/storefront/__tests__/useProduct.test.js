import { renderHook, waitFor } from "@testing-library/react";
import { useProduct } from "../hooks/useProduct";

jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));

const { supabase } = require("lib/supabaseClient");

const MOCK_PRODUCT = {
  productid: "BC25001",
  public_id: "k7x2m",
  name: "Silk Kurta",
  retailprice: 3500,
  fabric: "Silk",
  producturl: null,
  image_url: null,
  categories: { name: "Kurtas" },
};

const MOCK_VARIANTS = [
  { variantid: "v1", size: "S", color: "Red", stock: 2 },
  { variantid: "v2", size: "S", color: "Blue", stock: 0 },
  { variantid: "v3", size: "M", color: "Red", stock: 1 },
];

// One embedded query: products with its variants.
function mockQuery(result) {
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    single: jest.fn(() => Promise.resolve(result)),
  };
  supabase.from.mockReturnValue(chain);
  return chain;
}

const mockSuccess = () =>
  mockQuery({ data: { ...MOCK_PRODUCT, productsizecolors: MOCK_VARIANTS }, error: null });
const mockProductError = () => mockQuery({ data: null, error: { message: "Not found" } });

beforeEach(() => jest.clearAllMocks());

describe("useProduct", () => {
  it("starts in loading state", () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("k7x2m"));
    expect(result.current.loading).toBe(true);
    expect(result.current.product).toBeNull();
    expect(result.current.variants).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("returns product and variants on success", async () => {
    mockSuccess();
    const { result } = renderHook(() => useProduct("k7x2m"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.product).toEqual(MOCK_PRODUCT);
    expect(result.current.variants).toEqual(MOCK_VARIANTS);
    expect(result.current.error).toBeNull();
  });

  it("looks the product up by public id, with its variants in size then colour order", async () => {
    const chain = mockSuccess();
    const { result } = renderHook(() => useProduct("k7x2m"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("products");
    expect(chain.select.mock.calls[0][0]).toMatch(/\bpublic_id\b/);
    expect(chain.select.mock.calls[0][0]).toContain("productsizecolors(variantid, size, color, stock)");
    expect(chain.eq).toHaveBeenCalledWith("public_id", "k7x2m");
    expect(chain.order.mock.calls).toEqual([
      ["size", { referencedTable: "productsizecolors" }],
      ["color", { referencedTable: "productsizecolors" }],
    ]);
  });

  it("returns error when product fetch fails", async () => {
    mockProductError();
    const { result } = renderHook(() => useProduct("k7x2m"));
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
