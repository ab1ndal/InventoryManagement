import { formatSize, compareSizes, withStandardLetterSizes } from "../lib/sizes";

describe("formatSize", () => {
  test("letter sizes show the bust they fit", () => {
    expect(formatSize("XL|42")).toBe("XL (42)");
    expect(formatSize("2XL|44")).toBe("2XL (44)");
    expect(formatSize("XS|34")).toBe("XS (34)");
  });

  test("baby sizes with no measurement show the letter only", () => {
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

describe("withStandardLetterSizes", () => {
  test("pads XS to 2XL around the letter sizes a product has, with busts", () => {
    expect(withStandardLetterSizes(["XL|42", "L|40"])).toEqual([
      "XS|34", "S|36", "M|38", "L|40", "XL|42", "2XL|44",
    ]);
  });

  test("keeps extra letter sizes beyond the standard range", () => {
    expect(withStandardLetterSizes(["2XS|32", "M|38", "4XL|48"])).toEqual([
      "2XS|32", "XS|34", "S|36", "M|38", "L|40", "XL|42", "2XL|44", "4XL|48",
    ]);
  });

  test("a real code replaces the standard one for the same letter", () => {
    expect(withStandardLetterSizes(["XL|43"])).toEqual([
      "XS|34", "S|36", "M|38", "L|40", "XL|43", "2XL|44",
    ]);
  });

  test("bare letter codes are padded with bare letters", () => {
    expect(withStandardLetterSizes(["S", "M"])).toEqual(["XS", "S", "M", "L", "XL", "2XL"]);
  });

  test("non-letter sizes are unchanged and stay after letters", () => {
    expect(withStandardLetterSizes(["FREE-SIZE", "28"])).toEqual(["28", "FREE-SIZE"]);
    expect(withStandardLetterSizes(["10|30", "UNSTITCHED"])).toEqual(["10|30", "UNSTITCHED"]);
    expect(withStandardLetterSizes(["FREE-SIZE", "M|38"])).toEqual([
      "XS|34", "S|36", "M|38", "L|40", "XL|42", "2XL|44", "FREE-SIZE",
    ]);
  });

  test("baby sizes with no measurement are not padded with adult sizes", () => {
    expect(withStandardLetterSizes(["S|0", "M|0"])).toEqual(["S|0", "M|0"]);
  });

  test("empty input", () => {
    expect(withStandardLetterSizes([])).toEqual([]);
  });
});
