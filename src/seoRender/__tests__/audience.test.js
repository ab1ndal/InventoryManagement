import { categoryAudience } from "../audience";

describe("categoryAudience", () => {
  test.each([
    ["SA", { gender: "female", ageGroup: "adult" }],
    ["LE", { gender: "female", ageGroup: "adult" }],
    ["SW", { gender: "male", ageGroup: "adult" }],
    ["KP", { gender: "male", ageGroup: "adult" }],
    ["C-SW", { gender: "male", ageGroup: "kids" }],
  ])("%s", (id, expected) => expect(categoryAudience(id)).toEqual(expected));

  test("a future kids' category is kids, with no gender guessed", () => {
    expect(categoryAudience("C-LE")).toEqual({ ageGroup: "kids" });
  });

  test.each(["SHT", "JNS", "DPT", "FAB-V", "ACC", "NOPE", "", null, undefined])(
    "%p implies nothing",
    (id) => expect(categoryAudience(id)).toEqual({})
  );
});
