import { z } from "zod";

// Pure checkout helpers. No DB access, no payment integration — the
// checkout page these back is a UI-only placeholder (see CheckoutPage.jsx).

export const INDIAN_STATES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
];

const FREE_SHIPPING_THRESHOLD = 5000;
const STANDARD_SHIPPING_FEE = 99;

// Flat ₹99 shipping below ₹5000 subtotal, free at/above it.
export function shippingFee(subtotal) {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_FEE;
}

// The business is a GST composition dealer, which may not make inter-state
// supplies (CGST Act s.10(2)(c)), so online orders can only ship within
// Uttar Pradesh. UP pincodes start 20–28. See tasks/checkout-shipping-plan.md.
export const SERVICEABLE_STATE = "Uttar Pradesh";
const SERVICEABLE_PINCODE = /^2[0-8]\d{4}$/;
const OUT_OF_AREA =
  "We currently deliver within Uttar Pradesh only. WhatsApp us for other locations.";

export const addressSchema = z.object({
  name: z.string().min(2, "Enter your full name"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  line1: z.string().min(3, "Enter your address"),
  line2: z.string().optional().or(z.literal("")),
  city: z.string().min(2, "Enter your city"),
  state: z
    .enum(INDIAN_STATES, { errorMap: () => ({ message: "Select a state" }) })
    .refine((state) => state === SERVICEABLE_STATE, OUT_OF_AREA),
  pincode: z
    .string()
    .regex(/^\d{6}$/, "Enter a valid 6-digit pincode")
    .regex(SERVICEABLE_PINCODE, OUT_OF_AREA),
});
