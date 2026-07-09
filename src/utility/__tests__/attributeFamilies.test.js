import { buildFamilyIndex, toggleInArray } from "../attributeFamilies";

describe("buildFamilyIndex", () => {
  test("maps codes to families and families to codes", () => {
    const { familyToCodes, codeToFamilies } = buildFamilyIndex([
      { code: "Navy", families: ["Blue"] },
      { code: "Peacock", families: ["Blue", "Green"] },
    ]);
    expect([...familyToCodes.Blue].sort()).toEqual(["Navy", "Peacock"]);
    expect(familyToCodes.Green).toEqual(["Peacock"]);
    expect(codeToFamilies.Peacock).toEqual(["Blue", "Green"]);
  });

  test("orders families by member count desc, then name asc", () => {
    const { orderedFamilies } = buildFamilyIndex([
      { code: "a", families: ["Blue"] },
      { code: "b", families: ["Blue"] },
      { code: "c", families: ["Green"] },
      { code: "d", families: ["Amber"] },
    ]);
    expect(orderedFamilies).toEqual(["Blue", "Amber", "Green"]);
  });

  test("handles unassigned (empty families) codes", () => {
    const { codeToFamilies, orderedFamilies } = buildFamilyIndex([
      { code: "Cotton", families: [] },
      { code: "Silk", families: null },
    ]);
    expect(codeToFamilies.Cotton).toEqual([]);
    expect(codeToFamilies.Silk).toEqual([]);
    expect(orderedFamilies).toEqual([]);
  });
});

describe("toggleInArray", () => {
  test("adds when absent", () => {
    expect([...toggleInArray(["Blue"], "Green")].sort()).toEqual(["Blue", "Green"]);
  });
  test("removes when present", () => {
    expect(toggleInArray(["Blue", "Green"], "Blue")).toEqual(["Green"]);
  });
  test("treats null/undefined as empty", () => {
    expect(toggleInArray(null, "Blue")).toEqual(["Blue"]);
  });
});
