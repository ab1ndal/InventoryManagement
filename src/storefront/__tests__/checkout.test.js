import { addressSchema, checkoutSchema, shippingFee, normalizePhone } from "../lib/checkout";

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
    line1: "58",
    line2: "Sihani Gate Market",
    city: "Ghaziabad",
    state: "Uttar Pradesh",
    pincode: "201001",
  };

  it("accepts a valid Indian address", () => {
    expect(addressSchema.safeParse(valid).success).toBe(true);
  });

  it("requires the area/street line; landmark optional up to 100 characters", () => {
    const missing = addressSchema.safeParse({ ...valid, line2: " " });
    expect(missing.success).toBe(false);
    expect(missing.error.issues[0].message).toBe("Enter your area, street or village");
    expect(addressSchema.safeParse({ ...valid, landmark: "Near Durga Bhabhi Chowk" }).success).toBe(true);
    expect(addressSchema.safeParse({ ...valid, landmark: "x".repeat(101) }).success).toBe(false);
  });

  it("accepts a short flat number but not a blank one", () => {
    expect(addressSchema.safeParse({ ...valid, line1: "7" }).success).toBe(true);
    expect(addressSchema.safeParse({ ...valid, line1: "  " }).success).toBe(false);
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

describe("checkoutSchema", () => {
  const contact = { name: "Priya Sharma", phone: "9810873280", email: "" };

  it("needs only contact details for store pickup", () => {
    const result = checkoutSchema.safeParse({ ...contact, fulfilment: "pickup", line1: "", city: "", state: "", pincode: "" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...contact, fulfilment: "pickup" });
  });

  it("still validates contact details for store pickup", () => {
    expect(checkoutSchema.safeParse({ ...contact, phone: "12345", fulfilment: "pickup" }).success).toBe(false);
  });

  it("requires the address when shipping", () => {
    const result = checkoutSchema.safeParse({ ...contact, fulfilment: "ship", line1: "", city: "", state: "", pincode: "" });
    expect(result.success).toBe(false);
    expect(result.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(["line1", "line2", "city", "state", "pincode"]));
  });
});

// Checkout's field errors reach the shopper through this resolver, so run the real one.
describe("addressSchema through zodResolver", () => {
  const { zodResolver } = require("@hookform/resolvers/zod");
  const validAddress = {
    name: "Asha K",
    phone: "9876543210",
    email: "",
    line1: "12",
    line2: "MG Road",
    landmark: "",
    city: "Lucknow",
    state: "Uttar Pradesh",
    pincode: "226001",
  };
  const resolve = (values) =>
    zodResolver(addressSchema)(values, undefined, { fields: {}, shouldUseNativeValidation: false });

  test("a missing state shows 'Select a state' on the state field", async () => {
    const { errors } = await resolve({ ...validAddress, state: undefined });
    expect(errors.state.message).toBe("Select a state");
  });

  test("an unknown state shows 'Select a state' too", async () => {
    const { errors } = await resolve({ ...validAddress, state: "Atlantis" });
    expect(errors.state.message).toBe("Select a state");
  });

  test("custom messages from other fields come through", async () => {
    const { errors } = await resolve({ ...validAddress, phone: "123", pincode: "1", email: "nope" });
    expect(errors.phone.message).toBe("Enter a valid 10-digit Indian mobile number");
    expect(errors.pincode.message).toBe("Enter a valid 6-digit pincode");
    expect(errors.email.message).toBe("Invalid email");
  });

  test("valid details pass with their values intact", async () => {
    const { errors, values } = await resolve(validAddress);
    expect(errors).toEqual({});
    expect(values.state).toBe("Uttar Pradesh");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["9810873280", "9810873280"],
    ["98108 73280", "9810873280"],
    ["98108-73280", "9810873280"],
    ["+91 98108 73280", "9810873280"],
    ["+919810873280", "9810873280"],
    ["919810873280", "9810873280"],
    ["09810873280", "9810873280"],
    ["0 98108 73280", "9810873280"],
  ])("turns %s into the bare 10 digits", (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(["98108732", "+1 415 555 0132", "91981087", "+91 12345 67890", "919810873280 1", "abc", ""])(
    "still rejects %s",
    (raw) => {
      expect(/^[6-9]\d{9}$/.test(normalizePhone(raw))).toBe(false);
    }
  );

  it("is applied by the schema, which hands back the normalised value", () => {
    const result = checkoutSchema.safeParse({ name: "Priya Sharma", phone: "+91 98108 73280", email: "", fulfilment: "pickup" });
    expect(result.success).toBe(true);
    expect(result.data.phone).toBe("9810873280");
    expect(checkoutSchema.safeParse({ name: "Priya Sharma", phone: "+1 415 555 0132", email: "", fulfilment: "pickup" }).success).toBe(false);
  });
});
