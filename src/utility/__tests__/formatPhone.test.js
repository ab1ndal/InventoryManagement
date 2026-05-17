import { formatPhone } from "../formatPhone";

describe("formatPhone", () => {
  it("formats E.164 Indian number in international format", () => {
    expect(formatPhone("+919876543210")).toBe("+91 98765 43210");
  });

  it("formats E.164 US number in international format", () => {
    expect(formatPhone("+12025551234")).toBe("+1 202 555 1234");
  });

  it("returns dash for null", () => {
    expect(formatPhone(null)).toBe("-");
  });

  it("returns dash for empty string", () => {
    expect(formatPhone("")).toBe("-");
  });

  it("returns raw value for unparse-able input", () => {
    expect(formatPhone("not-a-phone")).toBe("not-a-phone");
  });

  it("formats already-formatted international number", () => {
    expect(formatPhone("+91 98765 43210")).toBe("+91 98765 43210");
  });
});
