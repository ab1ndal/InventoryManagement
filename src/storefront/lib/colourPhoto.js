const sameColour = (a, b) => a?.toLowerCase() === b?.toLowerCase();

// The line under the gallery when the shopper's colour has no photo of its own.
// `photoColours` holds the colour tag of every photo (null when untagged).
// Returns null when nothing needs saying: no colour picked, the shown photo is
// that colour, or some other photo is (the page switches to it).
export function colourPhotoNote({ selected, shown, photoColours }) {
  if (!selected) return null;
  if (photoColours.some((c) => sameColour(c, selected))) return null;
  return shown
    ? `Photo shows ${shown}. You picked ${selected}.`
    : `No photo of ${selected} yet.`;
}
