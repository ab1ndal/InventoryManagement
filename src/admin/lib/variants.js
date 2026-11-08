// src/admin/lib/variants.js
// Adding stock while entering a bill, for when the shelf is ahead of the inventory: a size and
// colour the product already has gets more stock, a new one becomes a new variant. Same writes
// as the inventory editor (src/admin/components/ProductTable.js): stock on an existing variant
// only moves by stock_adjust, because billing and online orders change it concurrently.
// Functions take the Supabase client; imports carry .js for Node ESM.
import { v4 as uuidv4 } from "uuid";
import { logActivityWith } from "./activity.js";
import { variantLabel } from "../../utility/activitySummary.js";

export class VariantInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "VariantInputError";
  }
}

// Metre stock is entered to the millimetre, as in the inventory editor.
const round3 = (n) => Math.round(n * 1000) / 1000;

/** Returns { variantid, created, stock } with the variant's stock after the change. */
export async function addVariantStock(client, { product, size, color, quantity }) {
  if (!size) throw new VariantInputError("Choose a size");
  if (!color) throw new VariantInputError("Choose a colour");
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw new VariantInputError("Stock to add must be more than 0");
  if (product.unit_type !== "meter" && !Number.isInteger(qty)) {
    throw new VariantInputError("Stock to add must be a whole number of pieces");
  }
  const label = variantLabel(size, color);

  // Looked up fresh: the picker's list may be minutes old.
  const { data: found, error: findErr } = await client
    .from("productsizecolors")
    .select("variantid, size, color, stock")
    .eq("productid", product.productid)
    .eq("size", size)
    .eq("color", color)
    .maybeSingle();
  if (findErr) throw findErr;

  if (found) {
    const { error } = await client.rpc("stock_adjust", {
      p_variant: found.variantid,
      p_delta: qty,
      p_reason: "manual_edit",
      p_ref: product.productid,
    });
    if (error) throw new Error(`Could not add stock to ${label}: ${error.message}`);
    const before = Number(found.stock ?? 0);
    const after = round3(before + qty);
    await logActivityWith(client, {
      action: "update",
      entityType: "stock",
      entityId: product.productid,
      summary: `Increased stock of ${label}, product ${product.productid} — ${product.name}: ${before} → ${after} (+${qty}) (from billing)`,
    });
    return { variantid: found.variantid, created: false, stock: after };
  }

  const row = { variantid: uuidv4(), productid: product.productid, size, color, stock: qty };
  const { error: insertErr } = await client.from("productsizecolors").insert(row);
  if (insertErr) throw new Error(`Could not add variant ${label}: ${insertErr.message}`);
  await logActivityWith(client, {
    action: "create",
    entityType: "variant",
    entityId: product.productid,
    summary: `Added variant ${label} to product ${product.productid} — ${product.name} (stock ${qty}) (from billing)`,
  });
  return { variantid: row.variantid, created: true, stock: qty };
}
