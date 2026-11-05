import { missingChoiceLabel, missingChoiceRow } from "../lib/variantChoice";

describe("missingChoiceLabel", () => {
  it("names what is really missing", () => {
    expect(missingChoiceLabel({ hasSize: true, hasColour: false })).toBe("Choose a colour");
    expect(missingChoiceLabel({ hasSize: false, hasColour: true })).toBe("Choose a size");
    expect(missingChoiceLabel({ hasSize: false, hasColour: false })).toBe("Choose a size and colour");
  });

  it("is null once both are chosen", () => {
    expect(missingChoiceLabel({ hasSize: true, hasColour: true })).toBeNull();
  });
});

describe("missingChoiceRow", () => {
  it("points at size first, then colour, then nothing", () => {
    expect(missingChoiceRow({ hasSize: false, hasColour: false })).toBe("size");
    expect(missingChoiceRow({ hasSize: true, hasColour: false })).toBe("colour");
    expect(missingChoiceRow({ hasSize: true, hasColour: true })).toBeNull();
  });
});
