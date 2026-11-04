import { readFilters, readSort, writeFilters, writeSort } from "../hooks/shopUrlState";
import { SORT_OPTIONS } from "../hooks/sortOptions";

const EMPTY = { categories: [], colors: [], sizes: [], fabrics: [], priceMin: null, priceMax: null };

describe("readFilters", () => {
  test("no parameters means no filters", () => {
    expect(readFilters(new URLSearchParams(""))).toEqual(EMPTY);
  });

  test("reads every filter, including size codes that hold a bar", () => {
    const params = new URLSearchParams("category=SA&color=Blue&color=Red&size=XL%7C42&fabric=Silk&min=500&max=2000");
    expect(readFilters(params)).toEqual({
      categories: ["SA"],
      colors: ["Blue", "Red"],
      sizes: ["XL|42"],
      fabrics: ["Silk"],
      priceMin: 500,
      priceMax: 2000,
    });
  });

  test("ignores repeats, blanks and prices that are not prices", () => {
    const params = new URLSearchParams("color=Blue&color=Blue&color=&min=abc&max=-5");
    expect(readFilters(params)).toEqual({ ...EMPTY, colors: ["Blue"] });
  });

  test("a link cannot step outside the page's categories or sizes", () => {
    const params = new URLSearchParams("category=LE&category=SA&size=S%7C36&size=4XL%7C48");
    const filters = readFilters(params, { scopeCategoryIds: ["SA"], scopeSizes: ["4XL|48"] });
    expect(filters.categories).toEqual(["SA"]);
    expect(filters.sizes).toEqual(["4XL|48"]);
  });
});

describe("writeFilters", () => {
  test("reads back what it wrote", () => {
    const filters = { ...EMPTY, colors: ["Blue", "Multi Colour"], sizes: ["XL|42"], priceMax: 1999 };
    expect(readFilters(writeFilters(new URLSearchParams(""), filters))).toEqual(filters);
  });

  test("clearing a filter removes it and leaves other parameters", () => {
    const params = new URLSearchParams("color=Blue&utm_source=wa&sort=price_asc&min=5");
    expect(writeFilters(params, EMPTY).toString()).toBe("utm_source=wa&sort=price_asc");
  });
});

describe("sort", () => {
  test("an unknown sort falls back to the default", () => {
    expect(readSort(new URLSearchParams("sort=hack"), SORT_OPTIONS, "newest")).toBe("newest");
    expect(readSort(new URLSearchParams("sort=price_asc"), SORT_OPTIONS, "newest")).toBe("price_asc");
  });

  test("the default stays out of the URL", () => {
    const params = writeSort(new URLSearchParams("color=Blue"), "price_asc", "newest");
    expect(params.toString()).toBe("color=Blue&sort=price_asc");
    expect(writeSort(params, "newest", "newest").toString()).toBe("color=Blue");
  });
});
