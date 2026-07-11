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

// Build a chainable mock for supabase.from(...).select(...).eq(...).order(...)
// that resolves to { data, error }. Returns the order spy so callers can assert.
function mockTable({ data = null, error = null } = {}) {
  const order = jest.fn(async () => ({ data, error }));
  const eq = jest.fn(() => ({ order }));
  const select = jest.fn(() => ({ eq }));
  supabase.from.mockReturnValue({ select, eq, order });
  return { select, eq, order };
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

  it("queries productimages by productid ordered by displayorder", async () => {
    const { select, eq, order } = mockTable({
      data: [
        { imageurl: "https://x/a.png", displayorder: 0 },
        { imageurl: "https://x/b.png", displayorder: 1 },
      ],
    });
    const paths = await getProductImagePaths("PIMG_ORDER");
    expect(supabase.from).toHaveBeenCalledWith("productimages");
    expect(select).toHaveBeenCalledWith("imageurl,displayorder");
    expect(eq).toHaveBeenCalledWith("productid", "PIMG_ORDER");
    expect(order).toHaveBeenCalledWith("displayorder", { ascending: true });
    expect(paths).toEqual(["https://x/a.png", "https://x/b.png"]);
  });

  it("filters out rows with a null imageurl", async () => {
    mockTable({
      data: [
        { imageurl: "https://x/a.png", displayorder: 0 },
        { imageurl: null, displayorder: 1 },
      ],
    });
    expect(await getProductImagePaths("PIMG_NULL")).toEqual(["https://x/a.png"]);
  });

  it("returns an empty array on query error", async () => {
    mockTable({ error: { message: "boom" } });
    expect(await getProductImagePaths("PIMG_ERR")).toEqual([]);
  });

  it("caches per productid — a second call does not re-query", async () => {
    mockTable({ data: [{ imageurl: "https://x/a.png", displayorder: 0 }] });
    await getProductImagePaths("PIMG_CACHE");
    await getProductImagePaths("PIMG_CACHE");
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});

describe("getProductImages / getProductImageUrl", () => {
  it("maps every path through imageUrl", async () => {
    mockTable({
      data: [
        { imageurl: "https://x/a.png", displayorder: 0 },
        { imageurl: "https://x/b.png", displayorder: 1 },
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
        { imageurl: "https://x/first.png", displayorder: 0 },
        { imageurl: "https://x/second.png", displayorder: 1 },
      ],
    });
    expect(await getProductImageUrl("PIMG_FIRST")).toBe("https://x/first.png");
  });

  it("returns null when a product has no images", async () => {
    mockTable({ data: [] });
    expect(await getProductImageUrl("PIMG_NONE")).toBeNull();
  });
});
