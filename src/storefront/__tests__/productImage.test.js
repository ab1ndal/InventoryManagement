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

const MOCKUP_DIR =
  "https://epotsxdugwfhyeiudjox.supabase.co/storage/v1/object/public/mockups/BC25054";
const MOCKUP = `${MOCKUP_DIR}/mahroon_89462790.webp`;

describe("imageUrl", () => {
  it("returns null for a falsy url", () => {
    expect(imageUrl(null)).toBeNull();
    expect(imageUrl("")).toBeNull();
  });

  it("returns the raw url when no transform is given", () => {
    expect(imageUrl("https://x/img.png")).toBe("https://x/img.png");
    expect(imageUrl(MOCKUP)).toBe(MOCKUP);
  });

  it("returns the raw url when the transform has no width", () => {
    expect(imageUrl(MOCKUP, {})).toBe(MOCKUP);
  });

  it.each([
    [48, 150],
    [150, 150],
    [151, 600],
    [400, 600],
    [600, 600],
    [1000, 1200],
    [1200, 1200],
    [1600, 1200],
  ])("maps width %i to the _%i.webp variant", (width, variant) => {
    expect(imageUrl(MOCKUP, { width })).toBe(
      `${MOCKUP_DIR}/mahroon_89462790_${variant}.webp`
    );
  });

  it("matches the .webp extension case-insensitively", () => {
    expect(imageUrl(`${MOCKUP_DIR}/a.WEBP`, { width: 400 })).toBe(
      `${MOCKUP_DIR}/a_600.webp`
    );
  });

  it("returns non-webp, other-bucket and other-host urls unchanged", () => {
    const png = `${MOCKUP_DIR}/a.png`;
    const otherBucket =
      "https://epotsxdugwfhyeiudjox.supabase.co/storage/v1/object/public/lifestyle/a.webp";
    const otherHost = "https://cdn.example.com/mockups/a.webp";
    expect(imageUrl(png, { width: 400 })).toBe(png);
    expect(imageUrl(otherBucket, { width: 400 })).toBe(otherBucket);
    expect(imageUrl(otherHost, { width: 400 })).toBe(otherHost);
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
        { productid: "PIMG_MAP", imageurl: `${MOCKUP_DIR}/a.webp`, displayorder: 0 },
        { productid: "PIMG_MAP", imageurl: `${MOCKUP_DIR}/b.webp`, displayorder: 1 },
      ],
    });
    expect(await getProductImages("PIMG_MAP", { width: 400 })).toEqual([
      `${MOCKUP_DIR}/a_600.webp`,
      `${MOCKUP_DIR}/b_600.webp`,
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
