import {
  money,
  variantLabel,
  customerName,
  diffFields,
} from "../activitySummary";

describe("money", () => {
  test("formats with ₹ and Indian grouping", () => {
    expect(money(3200)).toBe("₹3,200");
    expect(money(120000)).toBe("₹1,20,000");
  });
  test("handles nullish as ₹0", () => {
    expect(money(null)).toBe("₹0");
    expect(money(undefined)).toBe("₹0");
  });
});

describe("variantLabel", () => {
  test("color / size", () => {
    expect(variantLabel("M", "Red")).toBe("Red / M");
  });
  test("missing parts collapse cleanly", () => {
    expect(variantLabel("M", null)).toBe("M");
    expect(variantLabel(null, "Red")).toBe("Red");
    expect(variantLabel(null, null)).toBe("variant");
  });
});

describe("customerName", () => {
  test("joins first + last", () => {
    expect(customerName({ first_name: "Ravi", last_name: "Kumar" })).toBe("Ravi Kumar");
  });
  test("first only", () => {
    expect(customerName({ first_name: "Ravi", last_name: null })).toBe("Ravi");
  });
  test("nullish customer", () => {
    expect(customerName(null)).toBe("walk-in");
  });
});

describe("diffFields", () => {
  const oldObj = { name: "Kurta", retailprice: 1200, fabric: "Cotton" };
  const newObj = { name: "Cotton Kurta", retailprice: 1400, fabric: "Cotton" };

  test("lists only changed fields, quotes strings, bare numbers", () => {
    expect(diffFields(oldObj, newObj, ["name", "retailprice", "fabric"])).toBe(
      'name "Kurta"→"Cotton Kurta", retailprice 1200→1400'
    );
  });
  test("returns empty string when nothing changed", () => {
    expect(diffFields(oldObj, oldObj, ["name", "retailprice"])).toBe("");
  });
  test("ignores fields not in the list", () => {
    expect(diffFields(oldObj, newObj, ["fabric"])).toBe("");
  });
});
