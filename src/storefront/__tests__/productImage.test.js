jest.mock("lib/supabaseClient", () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from "lib/supabaseClient";
import {
  imageUrl,
  getProductImagePaths,
  getProductImages,
  getProductImageUrl,
} from "../lib/productImage";

// Build a chainable mock for the batched query:
//   supabase.from(...).select(...).in(...).order(...).order(...)
// that resolves to { data, error }. Returns the spies so callers can assert.
function mockTable({ data = null, error = null } = {}) {
  const orderInner = jest.fn(async () => ({ data, error }));
  const orderOuter = jest.fn(() => ({ order: orderInner }));
  const inFn = jest.fn(() => ({ order: orderOuter }));
  const select = jest.fn(() => ({ in: inFn }));
  supabase.from.mockReturnValue({ select });
  return { select, in: inFn, orderOuter, orderInner };
}

beforeEach(() => {
  supabase.from.mockReset();
});

describe("imageUrl", () => {
  it("returns null for a falsy url", () => {
    expect(imageUrl(null)).toBeNull();
    expect(imageUrl("")).toBeNull();
  });

  it("returns the raw url when no transform is given", () => {
    expect(imageUrl("https://x/img.png")).toBe("https://x/img.png");
  });

  it("returns the raw url outside production even with a transform", () => {
    // NODE_ENV is 'test' under Jest — the /_vercel/image endpoint doesn't exist.
    expect(imageUrl("https://x/img.png", { width: 400, quality: 70 })).toBe(
      "https://x/img.png"
    );
  });

  it("wraps in /_vercel/image with whitelisted w/q in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const out = imageUrl("https://x/img.png", { width: 400, quality: 70 });
      expect(out).toBe(
        "/_vercel/image?url=https%3A%2F%2Fx%2Fimg.png&w=400&q=70"
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("defaults quality to 75 when omitted in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(imageUrl("https://x/img.png", { width: 600 })).toContain("&q=75");
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe("getProductImagePaths", () => {
  it("returns an empty array for a falsy productid without querying", async () => {
    expect(await getProductImagePaths("")).toEqual([]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("batches by productid via in(...) ordered by displayorder", async () => {
    const { select, in: inFn, orderOuter, orderInner } = mockTable({
      data: [
        { productid: "PIMG_ORDER", imageurl: "https://x/a.png", displayorder: 0 },
        { productid: "PIMG_ORDER", imageurl: "https://x/b.png", displayorder: 1 },
      ],
    });
    const paths = await getProductImagePaths("PIMG_ORDER");
    expect(supabase.from).toHaveBeenCalledWith("productimages");
    expect(select).toHaveBeenCalledWith("productid,imageurl,displayorder");
    expect(inFn).toHaveBeenCalledWith("productid", ["PIMG_ORDER"]);
    expect(orderOuter).toHaveBeenCalledWith("productid", { ascending: true });
    expect(orderInner).toHaveBeenCalledWith("displayorder", { ascending: true });
    expect(paths).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("folds multiple productids requested in one tick into a single query", async () => {
    const { in: inFn } = mockTable({
      data: [
        { productid: "PIMG_A", imageurl: "https://x/a.png", displayorder: 0 },
        { productid: "PIMG_B", imageurl: "https://x/b.png", displayorder: 0 },
      ],
    });
    const [a, b] = await Promise.all([
      getProductImagePaths("PIMG_A"),
      getProductImagePaths("PIMG_B"),
    ]);
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(inFn).toHaveBeenCalledWith("productid", ["PIMG_A", "PIMG_B"]);
    expect(a).toEqual(["https://x/a.png"]);
    expect(b).toEqual(["https://x/b.png"]);
  });

  it("filters out rows with a null imageurl", async () => {
    mockTable({
      data: [
        { productid: "PIMG_NULL", imageurl: "https://x/a.png", displayorder: 0 },
        { productid: "PIMG_NULL", imageurl: null, displayorder: 1 },
      ],
    });
    expect(await getProductImagePaths("PIMG_NULL")).toEqual(["https://x/a.png"]);
  });

  it("returns an empty array on query error", async () => {
    mockTable({ error: { message: "boom" } });
    expect(await getProductImagePaths("PIMG_ERR")).toEqual([]);
  });

  it("caches per productid — a second call does not re-query", async () => {
    mockTable({
      data: [
        { productid: "PIMG_CACHE", imageurl: "https://x/a.png", displayorder: 0 },
      ],
    });
    await getProductImagePaths("PIMG_CACHE");
    await getProductImagePaths("PIMG_CACHE");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("getProductImages / getProductImageUrl", () => {
  it("maps every path through imageUrl", async () => {
    mockTable({
      data: [
        { productid: "PIMG_MAP", imageurl: "https://x/a.png", displayorder: 0 },
        { productid: "PIMG_MAP", imageurl: "https://x/b.png", displayorder: 1 },
      ],
    });
    expect(await getProductImages("PIMG_MAP")).toEqual([
      "https://x/a.png",
      "https://x/b.png",
    ]);
  });

  it("returns the first image url", async () => {
    mockTable({
      data: [
        { productid: "PIMG_FIRST", imageurl: "https://x/first.png", displayorder: 0 },
        { productid: "PIMG_FIRST", imageurl: "https://x/second.png", displayorder: 1 },
      ],
    });
    expect(await getProductImageUrl("PIMG_FIRST")).toBe("https://x/first.png");
  });

  it("returns null when a product has no images", async () => {
    mockTable({ data: [] });
    expect(await getProductImageUrl("PIMG_NONE")).toBeNull();
  });
});
