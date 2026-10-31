// src/admin/lib/manualItems.js
// Manual (non-inventory) items, shared by the admin CLI and, later, the admin
// screens. Rules mirror the billing screen's manual item form
// (src/admin/components/billing/ManualItemForm.js). Functions take the
// Supabase client as a parameter; imports carry .js extensions for Node ESM.
import { decodeZCodeToPrice, encodePriceToZCode } from "../../utility/zCode.js";

export class ManualItemInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ManualItemInputError";
  }
}

const blankToNull = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

const withZCode = (row) => ({
  ...row,
  cost_zcode: encodePriceToZCode(Number(row.purchase_price)),
});

/**
 * Manual items matching all given filters, newest first (max 20):
 * code = exact id (case-insensitive), name = substring, inStock = stock > 0.
 * Note the app never decrements manual-item stock on sale, so stock > 0 does
 * not prove the piece is unsold.
 */
export async function findManualItems(client, { code, name, inStock = false } = {}) {
  if (!blankToNull(code) && !blankToNull(name)) {
    throw new ManualItemInputError("Give a code or a name to search by");
  }
  let query = client
    .from("manual_items")
    .select("manual_item_id, name, categoryid, size, color, purchase_price, mrp, stock, created_at");
  if (blankToNull(code)) query = query.eq("manual_item_id", code.trim().toUpperCase());
  if (blankToNull(name)) query = query.ilike("name", `%${name.trim()}%`);
  if (inStock) query = query.gt("stock", 0);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map(withZCode);
}

/** Next id in the form's BCX{YY}{NNN} series for the given date's year. */
export async function nextManualItemId(client, date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const { data: maxNum, error } = await client.rpc("get_max_manual_item_suffix", {
    p_prefix: `BCX${yy}`,
  });
  if (error) throw new Error("Could not generate item ID: " + error.message);
  const maxStr = maxNum ? String(maxNum) : "";
  const current = maxStr.startsWith(yy) ? parseInt(maxStr.slice(yy.length) || "0", 10) : 0;
  return `BCX${yy}${String(current + 1).padStart(3, "0")}`;
}

/**
 * Create a manual item. Category must exist; cost is a Z-code (as on price
 * tags, e.g. "ZAAGB") or a plain number, and must decode to > 0, as the form
 * requires. With dryRun, returns { dry_run, would_insert } and writes nothing.
 */
export async function createManualItem(
  client,
  input,
  { dryRun = false, now = () => new Date() } = {},
) {
  const name = blankToNull(input.name);
  if (!name) throw new ManualItemInputError("Name is required");
  const categoryid = blankToNull(input.categoryid);
  if (!categoryid) throw new ManualItemInputError("Category is required");
  const mrp = Number(input.mrp);
  if (blankToNull(input.mrp) === null || !Number.isFinite(mrp) || mrp < 0) {
    throw new ManualItemInputError(`Invalid MRP "${input.mrp ?? ""}"`);
  }
  const purchasePrice = decodeZCodeToPrice(blankToNull(input.cost) ?? "");
  if (!(purchasePrice > 0)) {
    throw new ManualItemInputError(
      `A valid cost is required (Z-code like ZAAGB or a number), got "${input.cost ?? ""}"`,
    );
  }

  const { data: category, error: catErr } = await client
    .from("categories")
    .select("categoryid")
    .eq("categoryid", categoryid)
    .maybeSingle();
  if (catErr) throw catErr;
  if (!category) {
    throw new ManualItemInputError(`Unknown category "${categoryid}" (see: category list)`);
  }

  const row = {
    manual_item_id: await nextManualItemId(client, now()),
    name,
    categoryid,
    size: blankToNull(input.size),
    color: blankToNull(input.color),
    purchase_price: purchasePrice,
    mrp,
  };
  if (dryRun) return { dry_run: true, would_insert: row };

  const { data: saved, error } = await client
    .from("manual_items")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return withZCode(saved);
}
