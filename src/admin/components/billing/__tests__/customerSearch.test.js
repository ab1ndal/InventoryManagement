import { buildCustomerSearchFilter, cleanSearchTerm } from "../customerSearch";

describe("buildCustomerSearchFilter", () => {
  it("returns null for an empty search", () => {
    expect(buildCustomerSearchFilter("   ")).toBeNull();
    expect(buildCustomerSearchFilter(undefined)).toBeNull();
  });

  it("matches a single word on phone, first name and last name", () => {
    expect(buildCustomerSearchFilter("anita")).toBe(
      "phone.ilike.%anita%,first_name.ilike.%anita%,last_name.ilike.%anita%",
    );
  });

  it("matches 'first last' as first name AND last name", () => {
    const f = buildCustomerSearchFilter("Anita Sharma");
    expect(f).toContain("and(first_name.ilike.%Anita%,last_name.ilike.%Sharma%)");
  });

  it("uses first and last word when there are middle words", () => {
    expect(buildCustomerSearchFilter("Anita Devi Sharma")).toContain(
      "and(first_name.ilike.%Anita%,last_name.ilike.%Sharma%)",
    );
  });

  it("removes characters that would break the filter", () => {
    expect(cleanSearchTerm('a,b(c)%d\\e"f')).toBe("abcdef");
    expect(buildCustomerSearchFilter("Ann, (Lee)")).toBe(
      "phone.ilike.%Ann Lee%,first_name.ilike.%Ann Lee%,last_name.ilike.%Ann Lee%,and(first_name.ilike.%Ann%,last_name.ilike.%Lee%)",
    );
  });

  it("returns null when only unsafe characters were typed", () => {
    expect(buildCustomerSearchFilter(",()")).toBeNull();
  });
});
