import {
  sanitizeSearchQuery,
  matchCategoryIds,
  buildNameCategoryOr,
} from "../lib/searchUtils";

describe("sanitizeSearchQuery", () => {
  it("strips PostgREST/ilike-breaking characters", () => {
    expect(sanitizeSearchQuery("silk%,()_saree")).toBe("silk saree");
    expect(sanitizeSearchQuery('a"b\\c*')).toBe("a b c");
  });
  it("collapses whitespace and trims", () => {
    expect(sanitizeSearchQuery("  red   lehenga  ")).toBe("red lehenga");
  });
  it("caps length at 60 chars", () => {
    expect(sanitizeSearchQuery("x".repeat(100)).length).toBe(60);
  });
  it("handles empty/undefined input", () => {
    expect(sanitizeSearchQuery("")).toBe("");
    expect(sanitizeSearchQuery(undefined)).toBe("");
  });
});

describe("matchCategoryIds", () => {
  const cats = [
    { categoryid: "SAR", name: "Sarees" },
    { categoryid: "LEH", name: "Lehengas" },
    { categoryid: "SUI", name: "Salwar Suits" },
  ];
  it("matches category names case-insensitively by substring", () => {
    expect(matchCategoryIds("saree", cats)).toEqual(["SAR"]);
    expect(matchCategoryIds("SUIT", cats)).toEqual(["SUI"]);
  });
  it("returns [] when nothing matches or query is empty", () => {
    expect(matchCategoryIds("kurti", cats)).toEqual([]);
    expect(matchCategoryIds("", cats)).toEqual([]);
  });
});

describe("buildNameCategoryOr", () => {
  it("builds a name-only filter when no categories match", () => {
    expect(buildNameCategoryOr("silk", [])).toBe("name.ilike.%silk%");
  });
  it("adds a categoryid membership condition when categories match", () => {
    expect(buildNameCategoryOr("saree", ["SAR", "LEH"])).toBe(
      "name.ilike.%saree%,categoryid.in.(SAR,LEH)"
    );
  });
});
