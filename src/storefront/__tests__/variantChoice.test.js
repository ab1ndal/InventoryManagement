import { missingChoiceLabel, missingChoiceRow } from "../lib/variantChoice";
import { colourPhotoNote } from "../lib/colourPhoto";
import { whatsappPhotoRequestUrl } from "../lib/productText";

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

describe("colourPhotoNote", () => {
  it("names the colour shown and the colour picked", () => {
    expect(
      colourPhotoNote({ selected: "Red", shown: "Yellow-Red", photoColours: ["Yellow-Red", "Blue"] })
    ).toBe("Photo shows Yellow-Red. You picked Red.");
  });

  it("says only that there is no photo when the shown one is untagged", () => {
    expect(colourPhotoNote({ selected: "Red", shown: null, photoColours: [null, null] })).toBe(
      "No photo of Red yet."
    );
  });

  it("says nothing when no colour is picked", () => {
    expect(colourPhotoNote({ selected: undefined, shown: "Blue", photoColours: ["Blue"] })).toBeNull();
  });

  it("says nothing when a photo of the colour exists, ignoring case", () => {
    expect(colourPhotoNote({ selected: "Red", shown: "Red", photoColours: ["Red"] })).toBeNull();
    expect(colourPhotoNote({ selected: "red", shown: "Blue", photoColours: ["Blue", "RED"] })).toBeNull();
  });
});

describe("whatsappPhotoRequestUrl", () => {
  it("pre-fills the product code and colour", () => {
    const url = whatsappPhotoRequestUrl({ productid: "BC25001", colour: "Red" });
    expect(url).toContain("https://wa.me/");
    expect(decodeURIComponent(url.split("?text=")[1])).toBe("Please send a photo of BC25001 in Red");
  });
});
