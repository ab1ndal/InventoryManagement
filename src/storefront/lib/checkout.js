import { z } from "zod";
import { FREE_SHIPPING_THRESHOLD } from "./freeShipping";

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

const STANDARD_SHIPPING_FEE = 150;

// Flat ₹150 shipping below ₹5000 subtotal, free at/above it.
export function shippingFee(subtotal) {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : STANDARD_SHIPPING_FEE;
}

// The business is a GST composition dealer (CGST Act s.10(2)(c)) and usually
// delivers within Uttar Pradesh, but checkout accepts any state: the owner
// decides fulfilment for out-of-UP orders (owner decision 2026-10-30).
export const UP_STATE = "Uttar Pradesh";

const contactSchema = z.object({
  name: z.string().min(2, "Enter your full name"),
  phone: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
});

export const addressSchema = contactSchema.extend({
  line1: z.string().min(3, "Enter your address"),
  line2: z.string().optional().or(z.literal("")),
  city: z.string().min(2, "Enter your city"),
  state: z.enum(INDIAN_STATES, { errorMap: () => ({ message: "Select a state" }) }),
  pincode: z.string().regex(/^[1-9]\d{5}$/, "Enter a valid 6-digit pincode"),
});

// Store pickup needs only a name and phone to hand the order over; the
// address fields stay in the form (kept if the shopper switches back) but are
// neither validated nor sent.
export const checkoutSchema = z.discriminatedUnion("fulfilment", [
  addressSchema.extend({ fulfilment: z.literal("ship") }),
  contactSchema.extend({ fulfilment: z.literal("pickup") }),
]);
