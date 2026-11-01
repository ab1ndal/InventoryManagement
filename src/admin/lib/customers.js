// src/admin/lib/customers.js
// Customer operations shared by the admin CLI (scripts/admin-cli.mjs) and,
// later, the admin screens. Every function takes the Supabase client as a
// parameter so it runs both in the browser and in Node with the service key.
// Rules mirror the Add Customer form (src/admin/components/CustomerForm.js).
// Imports carry the .js extension because Node's ESM loader (used by the CLI)
// does not resolve extensionless paths; CRA/jest accept either.
import { customerName } from "../../utility/activitySummary.js";
import { logActivityWith } from "./activity.js";

export class CustomerInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "CustomerInputError";
  }
}

// Same rule as CustomerForm's zod schema.
const PHONE_RE = /^\+\d{10,15}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const blankToNull = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

/**
 * Spaces removed; a bare 10-digit Indian mobile gets +91 (how 88% of stored
 * phones look). Returns null for empty input; throws if the result is not a
 * valid +<country><number>.
 */
export function normalizePhone(raw) {
  const cleaned = blankToNull(raw)?.replace(/\s/g, "") ?? null;
  if (cleaned === null) return null;
  const phone = /^\d{10}$/.test(cleaned) ? `+91${cleaned}` : cleaned;
  if (!PHONE_RE.test(phone)) {
    throw new CustomerInputError(
      `Invalid phone "${raw}": expected 10 digits or +<country code><number>`,
    );
  }
  return phone;
}

/** The exact row createCustomer inserts. Throws CustomerInputError on bad input. */
export function buildCustomerPayload(input, customerUlid) {
  const firstName = blankToNull(input.first_name);
  if (!firstName) throw new CustomerInputError("First name is required");
  const email = blankToNull(input.email);
  if (email && !EMAIL_RE.test(email)) {
    throw new CustomerInputError(`Invalid email "${email}"`);
  }
  const phone = normalizePhone(input.phone);
  return {
    customer_ulid: customerUlid,
    first_name: firstName,
    last_name: blankToNull(input.last_name),
    phone,
    email,
    address: blankToNull(input.address),
    gender: blankToNull(input.gender),
    customer_notes: blankToNull(input.customer_notes),
    loyalty_tier: "bronze",
    store_credit: 0,
    referred_by: null,
    is_guest: !phone,
  };
}

/** Full customer row for this phone, or null. */
export async function findCustomerByPhone(client, rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new CustomerInputError("Phone is required");
  const { data, error } = await client
    .from("customers")
    .select("*")
    .eq("phone", phone)
    .order("customerid");
  if (error) throw error;
  return data?.[0] ?? null;
}

/**
 * Customers whose first or last name contains every word of `name`
 * (case-insensitive), max 20, oldest first. For slips without a phone.
 */
export async function findCustomersByName(client, name) {
  // Letters and digits only: punctuation (commas, dots, parens) is PostgREST
  // filter syntax inside or().
  const words = String(name ?? "")
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) throw new CustomerInputError("Name is required");
  let query = client.from("customers").select("*");
  for (const w of words) query = query.or(`first_name.ilike.%${w}%,last_name.ilike.%${w}%`);
  const { data, error } = await query.order("customerid").limit(20);
  if (error) throw error;
  return data ?? [];
}

// The suffix says where the change came from (the screen's entry has none).
const logCustomerCreated = (client, saved, source) =>
  logActivityWith(client, {
    action: "create",
    entityType: "customer",
    entityId: saved.customerid,
    summary: `Added customer ${customerName(saved)} (${saved.phone || "no phone"}) (${source})`,
  });

const newCustomerUlid = () =>
  crypto.randomUUID().replace(/-/g, "").slice(0, 26);

/**
 * Create a customer. A phone already on file is refused (phone = identity);
 * no phone means a guest. With dryRun, returns { dry_run, would_insert } and
 * writes nothing.
 */
export async function createCustomer(
  client,
  input,
  { dryRun = false, newUlid = newCustomerUlid, source = "via CLI" } = {},
) {
  const payload = buildCustomerPayload(input, newUlid());

  if (payload.phone) {
    const existing = await findCustomerByPhone(client, payload.phone);
    if (existing) {
      throw new CustomerInputError(
        `Phone ${payload.phone} already belongs to customer ${existing.customerid} (${customerName(existing)})`,
      );
    }
  }

  if (dryRun) return { dry_run: true, would_insert: payload };

  const { data: saved, error } = await client
    .from("customers")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;

  await logCustomerCreated(client, saved, source);
  return saved;
}
