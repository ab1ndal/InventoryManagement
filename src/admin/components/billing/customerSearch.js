import { withIndiaCode } from "../../lib/customers";

// Builds the PostgREST filter for the bill customer search.
// Characters that would break the filter syntax or act as wildcards are removed.
export const CUSTOMER_SEARCH_LIMIT = 8;

export const cleanSearchTerm = (term) =>
  String(term ?? "").replace(/[,()%\\"]/g, "").trim();

// Starting values for "Add this customer": a number becomes the phone,
// otherwise the first word is the first name and the rest the last name.
export function customerDraftFromSearch(term) {
  const text = String(term ?? "").trim();
  if (!text) return {};
  if (/^\+?[\d\s-]+$/.test(text)) return { phone: withIndiaCode(text.replace(/[\s-]/g, "")) };
  const [first, ...rest] = text.split(/\s+/);
  return { first_name: first, last_name: rest.join(" ") };
}

export function buildCustomerSearchFilter(term) {
  const safe = cleanSearchTerm(term);
  if (!safe) return null;
  const parts = [
    `phone.ilike.%${safe}%`,
    `first_name.ilike.%${safe}%`,
    `last_name.ilike.%${safe}%`,
  ];
  // "First Last": first word against first name, last word against last name.
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    parts.push(
      `and(first_name.ilike.%${words[0]}%,last_name.ilike.%${words[words.length - 1]}%)`,
    );
  }
  return parts.join(",");
}
