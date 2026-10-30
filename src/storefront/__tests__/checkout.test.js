import { addressSchema, shippingFee } from "../lib/checkout";

describe("shippingFee", () => {
  it("charges ₹150 below the ₹5000 free-shipping threshold", () => {
    expect(shippingFee(4999)).toBe(150);
  });

  it("is free at exactly ₹5000", () => {
    expect(shippingFee(5000)).toBe(0);
  });

  it("is free above ₹5000", () => {
    expect(shippingFee(6000)).toBe(0);
  });
});

describe("addressSchema", () => {
  const valid = {
    name: "Priya Sharma",
    phone: "9810873280",
    email: "priya@example.com",
    line1: "58 Sihani Gate Market",
    line2: "",
    city: "Ghaziabad",
    state: "Uttar Pradesh",
    pincode: "201001",
  };

  it("accepts a valid Indian address", () => {
    expect(addressSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a 9-digit phone number", () => {
    const result = addressSchema.safeParse({ ...valid, phone: "981087328" });
    expect(result.success).toBe(false);
  });

  it("accepts an address outside Uttar Pradesh", () => {
    expect(addressSchema.safeParse({ ...valid, city: "New Delhi", state: "Delhi", pincode: "110001" }).success).toBe(true);
  });

  it("requires a state", () => {
    const result = addressSchema.safeParse({ ...valid, state: "" });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("Select a state");
  });

  it("rejects a pincode starting with 0", () => {
    expect(addressSchema.safeParse({ ...valid, pincode: "012345" }).success).toBe(false);
  });

  it("rejects a 5-digit pincode", () => {
    const result = addressSchema.safeParse({ ...valid, pincode: "20100" });
    expect(result.success).toBe(false);
  });
});
