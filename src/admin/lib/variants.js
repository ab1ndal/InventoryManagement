// src/admin/lib/variants.js
// Adding stock while entering a bill, for when the shelf is ahead of the inventory: a size and
// colour the product already has gets more stock, a new one becomes a new variant. Same writes
// as the inventory editor (src/admin/components/ProductTable.js): stock on an existing variant
// only moves by stock_adjust, because billing and online orders change it concurrently.
// The admin CLI's `stock add` uses the same writes, by product code, as do a bill spec's
// stock_adds, which undoStockAdds takes back if the bill then fails.
// Functions take the Supabase client; imports carry .js for Node ESM.
import { v4 as uuidv4 } from "uuid";
import { logActivityWith } from "./activity.js";
import { findProducts, normalizeProductCode } from "./products.js";
import { variantLabel } from "../../utility/activitySummary.js";

export class VariantInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "VariantInputError";
  }
}

// Metre stock is entered to the millimetre, as in the inventory editor.
const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * Returns { variantid, created, stock_before, stock } with the variant's stock after the change.
 * With dryRun, checks and looks up the variant, returns the same with dry_run: true and writes
 * nothing (variantid is null for a variant that would be created). `source` ends the activity
 * summary: "from billing" on the screen, "via CLI" from the admin CLI.
 */
export async function addVariantStock(
  client,
  { product, size, color, quantity },
  { dryRun = false, source = "from billing" } = {},
) {
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

  const before = found ? Number(found.stock ?? 0) : 0;
  const after = round3(before + qty);
  if (dryRun) {
    return { dry_run: true, variantid: found?.variantid ?? null, created: !found, stock_before: before, stock: after };
  }

  if (found) {
    const { error } = await client.rpc("stock_adjust", {
      p_variant: found.variantid,
      p_delta: qty,
      p_reason: "manual_edit",
      p_ref: product.productid,
    });
    if (error) throw new Error(`Could not add stock to ${label}: ${error.message}`);
    await logActivityWith(client, {
      action: "update",
      entityType: "stock",
      entityId: product.productid,
      summary: `Increased stock of ${label}, product ${product.productid} — ${product.name}: ${before} → ${after} (+${qty}) (${source})`,
    });
    return { variantid: found.variantid, created: false, stock_before: before, stock: after };
  }

  const row = { variantid: uuidv4(), productid: product.productid, size, color, stock: qty };
  const { error: insertErr } = await client.from("productsizecolors").insert(row);
  if (insertErr) throw new Error(`Could not add variant ${label}: ${insertErr.message}`);
  await logActivityWith(client, {
    action: "create",
    entityType: "variant",
    entityId: product.productid,
    summary: `Added variant ${label} to product ${product.productid} — ${product.name} (stock ${qty}) (${source})`,
  });
  return { variantid: row.variantid, created: true, stock_before: 0, stock: qty };
}

const sameText = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/**
 * Admin CLI `stock add`: adds stock to a product's variant by product code. Size and colour match
 * an existing variant ignoring case and spaces, and the variant's own spelling is kept. A size and
 * colour the product doesn't have is refused unless allowNewVariant, so a typo or a near shade
 * (Yellow for Mustard) can't quietly become a new variant.
 */
export async function addStockByCode(
  client,
  { code, size, color, quantity, allowNewVariant = false },
  { dryRun = false } = {},
) {
  const productid = normalizeProductCode(code);
  const products = await findProducts(client, code);
  const product = products.find((p) => p.productid === productid);
  if (!product) {
    const near = products.map((p) => p.productid).join(", ");
    throw new VariantInputError(`No product ${productid}${near ? ` (similar codes: ${near})` : ""}`);
  }
  const match = product.variants.find((v) => sameText(v.size, size) && sameText(v.color, color));
  if (!match && !allowNewVariant) {
    const have = product.variants.map((v) => variantLabel(v.size, v.color)).join("; ") || "none";
    throw new VariantInputError(
      `${productid} has no ${variantLabel(size, color)} variant (has: ${have}). Pass --new-variant to add it`,
    );
  }
  const target = match ?? (await knownSizeAndColour(client, size, color));
  const result = await addVariantStock(
    client,
    { product, size: target.size, color: target.color, quantity },
    { dryRun, source: "via CLI" },
  );
  return { productid, name: product.name, size: target.size, color: target.color, ...result };
}

/**
 * Takes back stock adds (addStockByCode results, each with the qty added) after the bill they were
 * made for failed, newest first. A variant an add created is deleted again; the database refuses
 * that while anything references it (a bill line, a cart, an order), and then, as for any other
 * add, the stock is taken back with stock_adjust. Returns a one-line summary for the bill's error
 * message instead of throwing, so the bill's own error still reaches the operator, with any add
 * it could not undo named for fixing by hand.
 */
export async function undoStockAdds(client, added, { source = "via CLI" } = {}) {
  const undone = [];
  const failed = [];
  for (const a of [...added].reverse()) {
    const label = `${a.productid} ${variantLabel(a.size, a.color)} +${a.qty}`;
    try {
      undone.push(`${label} ${await undoStockAdd(client, a, source)}`);
    } catch (e) {
      failed.push(`${label} (${e.message})`);
    }
  }
  if (failed.length === 0) return `stock adds undone: ${undone.join("; ")}`;
  return `stock adds NOT all undone, fix them in the inventory editor: ${failed.join("; ")}` +
    (undone.length ? `; undone: ${undone.join("; ")}` : "");
}

async function undoStockAdd(client, a, source) {
  const label = variantLabel(a.size, a.color);
  let kept = null;
  if (a.created) {
    const { data, error } = await client.from("productsizecolors").delete().eq("variantid", a.variantid).select("variantid");
    if (!error && data?.length) {
      await logActivityWith(client, {
        action: "delete",
        entityType: "variant",
        entityId: a.productid,
        summary: `Deleted variant ${label} from product ${a.productid} — ${a.name}, added for a bill that failed (${source})`,
      });
      return "variant removed";
    }
    // In use (or not deletable): keep the variant and take its stock back instead.
    kept = error ? error.message : "nothing deleted";
  }
  const { data: after, error } = await client.rpc("stock_adjust", {
    p_variant: a.variantid,
    p_delta: -a.qty,
    p_reason: "manual_edit",
    p_ref: a.productid,
  });
  if (error) throw new Error(`could not take the stock back: ${error.message}`);
  const now = Number(after);
  await logActivityWith(client, {
    action: "update",
    entityType: "stock",
    entityId: a.productid,
    summary: `Decreased stock of ${label}, product ${a.productid} — ${a.name}: ${round3(now + a.qty)} → ${now} (-${a.qty}), added for a bill that failed (${source})`,
  });
  return kept ? `stock taken back, variant kept (${kept})` : "stock taken back";
}

// A new variant takes its size and colour from the inventory's lists, as the screen's dropdowns do.
async function knownSizeAndColour(client, size, color) {
  const [sizes, colors] = await Promise.all([
    client.from("sizes").select("code").order("sort_order"),
    client.from("colors").select("code").order("code"),
  ]);
  if (sizes.error) throw sizes.error;
  if (colors.error) throw colors.error;
  const knownSize = (sizes.data ?? []).find((s) => sameText(s.code, size));
  if (!knownSize) throw new VariantInputError(`Unknown size "${size ?? ""}": use a size code like XL|42`);
  const knownColor = (colors.data ?? []).find((c) => sameText(c.code, color));
  if (!knownColor) throw new VariantInputError(`Unknown colour "${color ?? ""}"`);
  return { size: knownSize.code, color: knownColor.code };
}
