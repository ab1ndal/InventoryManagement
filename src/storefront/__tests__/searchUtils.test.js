import {
  sanitizeSearchQuery,
  matchCategoryIds,
  normaliseWord,
  splitSearchWords,
  isProductCode,
  matchColourCodes,
  buildWordOr,
  buildSearchFilters,
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

describe("sanitizeSearchQuery quotes", () => {
  it("strips quotes and backticks", () => {
    expect(sanitizeSearchQuery("men's `kurta`")).toBe("men s kurta");
  });
});

describe("normaliseWord", () => {
  it.each([
    ["sari", "saree"],
    ["Sarees", "saree"],
    ["lehnga", "lehenga"],
    ["lengha", "lehenga"],
    ["Lehengas", "lehenga"],
    ["kurtis", "kurti"],
    ["kurtas", "kurta"],
    ["suits", "suit"],
    ["gowns", "gown"],
    ["sherwanis", "sherwani"],
    ["kids", "child"],
    ["children", "child"],
    ["dupattas", "dupatta"],
    ["dresses", "dress"],
    ["dress", "dress"],
    ["BC25001", "bc25001"],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseWord(input)).toBe(expected);
  });
  it("keeps kurti and kurta apart", () => {
    expect(normaliseWord("kurti")).not.toBe(normaliseWord("kurta"));
  });
});

describe("splitSearchWords", () => {
  it("splits, normalises and drops repeats and single letters", () => {
    expect(splitSearchWords("red sarees a sari")).toEqual(["red", "saree"]);
  });
  it("caps the number of words", () => {
    expect(splitSearchWords("aa bb cc dd ee ff gg hh")).toHaveLength(6);
  });
  it("handles empty input", () => {
    expect(splitSearchWords("")).toEqual([]);
  });
});

describe("isProductCode", () => {
  it("accepts product ids in any case and rejects words", () => {
    expect(isProductCode("BC25001")).toBe(true);
    expect(isProductCode("bc25001")).toBe(true);
    expect(isProductCode("saree")).toBe(false);
    expect(isProductCode("2025")).toBe(false);
  });
});

describe("matchColourCodes", () => {
  const colours = [
    { code: "Red", families: ["Red"] },
    { code: "Wine Red", families: ["Red"] },
    { code: "Navy Blue", families: ["Blue"] },
    { code: "Off White", families: ["White/Cream"] },
    { code: "Maroon", families: ["Red"] },
    { code: "Black Print", families: ["Black"] },
  ];
  it("returns every code in the family", () => {
    expect(matchColourCodes("red", colours)).toEqual(["Red", "Wine Red", "Maroon"]);
  });
  it("matches either side of a combined family name", () => {
    expect(matchColourCodes("cream", colours)).toEqual(["Off White"]);
  });
  it("matches an exact colour name outside the families", () => {
    expect(matchColourCodes("maroon", [{ code: "Maroon", families: [] }])).toEqual(["Maroon"]);
  });
  it("does not treat part of a colour name as a colour", () => {
    expect(matchColourCodes("print", colours)).toEqual([]);
  });
  it("returns [] for no colours or empty word", () => {
    expect(matchColourCodes("red", undefined)).toEqual([]);
    expect(matchColourCodes("", colours)).toEqual([]);
  });
});

describe("buildWordOr", () => {
  it("searches name, title, description and fabric", () => {
    expect(buildWordOr("silk", [])).toBe(
      "name.ilike.%silk%,display_title.ilike.%silk%,description.ilike.%silk%,fabric.ilike.%silk%"
    );
  });
  it("adds a categoryid membership condition when categories match", () => {
    expect(buildWordOr("saree", ["SA", "LE"])).toMatch(/,categoryid\.in\.\(SA,LE\)$/);
  });
  it("matches a full product code exactly, ignoring case", () => {
    expect(buildWordOr("bc25001", [])).toContain(",productid.ilike.bc25001");
    expect(buildWordOr("bc25001", [])).not.toContain("productid.ilike.%");
  });
  it("matches a partial code with digits as a substring", () => {
    expect(buildWordOr("bc25", [])).toContain(",productid.ilike.%bc25%");
  });
});

describe("buildSearchFilters", () => {
  const categories = [
    { categoryid: "SA", name: "Saree" },
    { categoryid: "LE", name: "Lehenga" },
  ];
  const colours = [
    { code: "Red", families: ["Red"] },
    { code: "Wine Red", families: ["Red"] },
    { code: "Navy Blue", families: ["Blue"] },
  ];

  it("makes one group per text word so every word must match", () => {
    const { orGroups, colourFilters } = buildSearchFilters("wedding silk", { categories, colours });
    expect(orGroups).toHaveLength(2);
    expect(orGroups[0]).toContain("description.ilike.%wedding%");
    expect(orGroups[1]).toContain("fabric.ilike.%silk%");
    expect(colourFilters).toEqual([]);
  });
  it("turns a colour word into a variant colour filter and keeps the rest as text", () => {
    const { orGroups, colourFilters } = buildSearchFilters("red sari", { categories, colours });
    expect(colourFilters).toEqual([{ alias: "colour0", codes: ["Red", "Wine Red"] }]);
    expect(orGroups).toHaveLength(1);
    expect(orGroups[0]).toContain("name.ilike.%saree%");
    expect(orGroups[0]).toContain("categoryid.in.(SA)");
  });
  it("limits colour words, treating extras as text", () => {
    const { orGroups, colourFilters } = buildSearchFilters("red blue red", { categories, colours });
    expect(colourFilters.map((f) => f.alias)).toEqual(["colour0", "colour1"]);
    expect(orGroups).toEqual([]);
  });
  it("treats colour words as text when the colour list is missing", () => {
    const { orGroups, colourFilters } = buildSearchFilters("red", { categories, colours: [] });
    expect(colourFilters).toEqual([]);
    expect(orGroups).toHaveLength(1);
  });
  it("finds a product code", () => {
    const { orGroups } = buildSearchFilters("BC25001", { categories, colours });
    expect(orGroups[0]).toContain("productid.ilike.bc25001");
  });
  it("cannot be broken or widened by hostile input once sanitised", () => {
    const clean = sanitizeSearchQuery('x),id.neq.0,name.ilike.%"\\(y_%');
    const { orGroups } = buildSearchFilters(clean, { categories, colours });
    const all = orGroups.join("|");
    expect(clean).not.toMatch(/[,()%_"\\]/);
    // Every comma-separated condition is one of ours; nothing injected a new column.
    all
      .split(/[,|]/)
      .filter((c) => !/^\d+$/.test(c) && !/^[A-Za-z-]+$/.test(c))
      .forEach((c) =>
        expect(c).toMatch(/^(name|display_title|description|fabric|productid)\.ilike\.|^categoryid\.in\./)
      );
  });
});
