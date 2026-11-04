import { supabase } from "../../../lib/supabaseClient";

// Lists that rarely change, shared by every bill opened in this tab so each open does not re-fetch
// them. BillingPage clears them on arrival, so edits made on other admin pages show on return. Another
// staff member's edit can take this long to appear.
const FRESH_FOR_MS = 5 * 60 * 1000;
// Discounts change money, so they are reused only briefly: long enough for New Bill to open instantly
// after the page preloads, and for a quick reopen.
const DISCOUNTS_FRESH_FOR_MS = 60 * 1000;

const entries = new Map();

function shared(key, query, freshForMs = FRESH_FOR_MS) {
  const entry = entries.get(key);
  if (entry && Date.now() - entry.at < freshForMs) return entry.result;

  // Concurrent callers get the same promise. A failure is not kept, so the next open retries.
  const result = Promise.resolve(query()).then(
    (response) => {
      if (response.error) entries.delete(key);
      return response;
    },
    (err) => {
      entries.delete(key);
      throw err;
    },
  );
  entries.set(key, { at: Date.now(), result });
  return result;
}

export const clearBillingLookups = () => entries.clear();

export const loadCategories = () =>
  shared("categories", () => supabase.from("categories").select("categoryid, name"));

export const loadSalesLocations = () =>
  shared("saleslocations", () =>
    supabase.from("saleslocations").select("saleslocationid, locationname").order("saleslocationid"),
  );

export const loadSalesMethods = () =>
  shared("salesmethods", () =>
    supabase.from("salesmethods").select("salesmethodid, methodname").order("salesmethodid"),
  );

export const loadActiveSalespeople = () =>
  shared("salespersons", () =>
    supabase.from("salespersons").select("salesperson_id, name").eq("active", true).order("name"),
  );

export const DISCOUNT_COLUMNS =
  "id, code, type, value, max_discount, category, once_per_customer, exclusive, auto_apply, min_total, start_date, end_date, active, rules";

// Start and end dates are checked by the caller, so a cached list cannot outlive a discount's dates.
export const loadActiveDiscounts = () =>
  shared(
    "discounts",
    () => supabase.from("discounts").select(DISCOUNT_COLUMNS).eq("active", true),
    DISCOUNTS_FRESH_FOR_MS,
  );

// Fetched when the Bills page opens, so New Bill has everything it needs the moment it is clicked.
// A failure here is reported by whichever form asks for the list next.
export const preloadBillingLookups = () => {
  loadCategories();
  loadSalesLocations();
  loadSalesMethods();
  loadActiveSalespeople();
  loadActiveDiscounts();
};
