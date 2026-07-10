import { sortOrderClause, SORT_OPTIONS } from "../hooks/sortOptions";

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
