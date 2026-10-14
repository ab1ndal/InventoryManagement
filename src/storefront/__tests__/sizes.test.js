import { formatSize, compareSizes } from "../lib/sizes";

describe("formatSize", () => {
  test("letter sizes drop the garment number", () => {
    expect(formatSize("XL|42")).toBe("XL");
    expect(formatSize("2XL|44")).toBe("2XL");
    expect(formatSize("XS|34")).toBe("XS");
    expect(formatSize("S|0")).toBe("S");
  });

  test("special codes read as words", () => {
    expect(formatSize("FREE-SIZE")).toBe("Free Size");
    expect(formatSize("UNSTITCHED")).toBe("Unstitched");
    expect(formatSize("SEMI-STITCHED")).toBe("Semi-stitched");
  });

  test("numeric sizes stay readable", () => {
    expect(formatSize("32")).toBe("32");
    expect(formatSize("10|30")).toBe("10 (30)");
  });

  test("empty input", () => {
    expect(formatSize("")).toBe("");
    expect(formatSize(undefined)).toBe("");
  });
});

describe("compareSizes", () => {
  test("letter sizes in logical order, not alphabetical", () => {
    const codes = ["XL|42", "2XL|44", "L|40", "S|36", "M|38", "XS|34", "6XL|52", "3XL|46", "2XS|32"];
    expect([...codes].sort(compareSizes)).toEqual([
      "2XS|32", "XS|34", "S|36", "M|38", "L|40", "XL|42", "2XL|44", "3XL|46", "6XL|52",
    ]);
  });

  test("numeric sizes by number, specials after", () => {
    expect(["FREE-SIZE", "36", "30", "10|30", "2|22"].sort(compareSizes)).toEqual([
      "2|22", "10|30", "30", "36", "FREE-SIZE",
    ]);
  });

  test("letters before specials", () => {
    expect(["UNSTITCHED", "M|38", "FREE-SIZE"].sort(compareSizes)).toEqual([
      "M|38", "FREE-SIZE", "UNSTITCHED",
    ]);
  });
});
