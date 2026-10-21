import {
  sortOrderClause,
  SORT_OPTIONS,
  CURATED_SORT,
  sortOptionsFor,
  sortByCuratedOrder,
} from "../hooks/sortOptions";

describe("sortOrderClause", () => {
  it("defaults to newest (productid desc)", () => {
    expect(sortOrderClause("newest")).toEqual({ column: "productid", ascending: false });
    expect(sortOrderClause(undefined)).toEqual({ column: "productid", ascending: false });
  });
  it("maps price ascending", () => {
    expect(sortOrderClause("price_asc")).toEqual({ column: "retailprice", ascending: true });
  });
  it("maps price descending", () => {
    expect(sortOrderClause("price_desc")).toEqual({ column: "retailprice", ascending: false });
  });
  it("exposes three options whose values round-trip through sortOrderClause", () => {
    expect(SORT_OPTIONS.map((o) => o.value)).toEqual(["newest", "price_asc", "price_desc"]);
    SORT_OPTIONS.forEach((o) => expect(sortOrderClause(o.value)).toBeTruthy());
  });
});

describe("curated sort", () => {
  it("offers Featured first only for a curated product list", () => {
    expect(sortOptionsFor(false)).toEqual(SORT_OPTIONS);
    const curated = sortOptionsFor(true);
    expect(curated[0]).toEqual({ value: CURATED_SORT, label: "Featured" });
    expect(curated.slice(1)).toEqual(SORT_OPTIONS);
  });

  it("orders rows by their position in the curated id list", () => {
    const rows = [{ productid: "C" }, { productid: "A" }, { productid: "B" }];
    expect(sortByCuratedOrder(rows, ["A", "B", "C"]).map((r) => r.productid)).toEqual(["A", "B", "C"]);
    expect(rows.map((r) => r.productid)).toEqual(["C", "A", "B"]);
  });
});
