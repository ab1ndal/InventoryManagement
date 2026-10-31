#!/usr/bin/env node
/**
 * Command-line access to admin features (customers today; bills next), for
 * entering and auditing data without the admin screens. Thin wrapper: all
 * rules live in the shared modules under src/admin/lib/.
 *
 *   node scripts/admin-cli.mjs <area> <action> [--options]
 *
 * Success: JSON on stdout, exit 0. Failure: {"error","type"} JSON on stderr,
 * exit 2 for bad input, 1 for anything else. Every write accepts --dry-run.
 * Runs with SUPABASE_SERVICE_ROLE_KEY from .env, so it bypasses RLS: local,
 * developer-only. Guide: docs/admin-cli.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

// src/ is untyped ESM shared with CRA; marking it "type": "module" would force
// extensionful imports on the whole app. Node warns when loading it, so drop
// only that warning (before the dynamic import below) to keep stderr clean.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.error(w);
});
const { findCustomerByPhone, createCustomer, CustomerInputError } = await import(
  "../src/admin/lib/customers.js"
);
const { findProducts, listCategories } = await import("../src/admin/lib/products.js");
const { findManualItems, createManualItem, ManualItemInputError } = await import(
  "../src/admin/lib/manualItems.js"
);
const { prepareBill, createBill, getBill, BillInputError } = await import(
  "../src/admin/lib/bills.js"
);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function makeClient() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new UsageError("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS = {
  customer: {
    find: {
      usage: "customer find --phone <phone>",
      options: { phone: { type: "string" } },
      run: (client, o) => {
        if (!o.phone) throw new UsageError("--phone is required");
        return findCustomerByPhone(client, o.phone);
      },
    },
    create: {
      usage:
        "customer create --first <name> [--last <name>] [--phone <phone>] [--email <email>] [--address <text>] [--gender <text>] [--notes <text>] [--dry-run]",
      options: {
        first: { type: "string" },
        last: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        address: { type: "string" },
        gender: { type: "string" },
        notes: { type: "string" },
        "dry-run": { type: "boolean" },
      },
      run: (client, o) =>
        createCustomer(
          client,
          {
            first_name: o.first,
            last_name: o.last,
            phone: o.phone,
            email: o.email,
            address: o.address,
            gender: o.gender,
            customer_notes: o.notes,
          },
          { dryRun: Boolean(o["dry-run"]) },
        ),
    },
  },
  product: {
    find: {
      usage: "product find --code <product code>",
      options: { code: { type: "string" } },
      run: (client, o) => {
        if (!o.code) throw new UsageError("--code is required");
        return findProducts(client, o.code);
      },
    },
  },
  category: {
    list: {
      usage: "category list",
      options: {},
      run: (client) => listCategories(client),
    },
  },
  "manual-item": {
    find: {
      usage: "manual-item find [--code <BCX id>] [--name <text>] [--in-stock]",
      options: {
        code: { type: "string" },
        name: { type: "string" },
        "in-stock": { type: "boolean" },
      },
      run: (client, o) =>
        findManualItems(client, { code: o.code, name: o.name, inStock: Boolean(o["in-stock"]) }),
    },
    create: {
      usage:
        "manual-item create --name <text> --category <id> --mrp <amount> --cost <Z-code|amount> [--size <text>] [--color <text>] [--dry-run]",
      options: {
        name: { type: "string" },
        category: { type: "string" },
        mrp: { type: "string" },
        cost: { type: "string" },
        size: { type: "string" },
        color: { type: "string" },
        "dry-run": { type: "boolean" },
      },
      run: (client, o) =>
        createManualItem(
          client,
          {
            name: o.name,
            categoryid: o.category,
            mrp: o.mrp,
            cost: o.cost,
            size: o.size,
            color: o.color,
          },
          { dryRun: Boolean(o["dry-run"]) },
        ),
    },
  },
  bill: {
    preview: {
      usage: "bill preview (--spec <file.json> | --json '<spec>')",
      options: { spec: { type: "string" }, json: { type: "string" } },
      run: (client, o) => prepareBill(client, readSpec(o)),
    },
    create: {
      usage: "bill create (--spec <file.json> | --json '<spec>') [--dry-run]",
      options: { spec: { type: "string" }, json: { type: "string" }, "dry-run": { type: "boolean" } },
      run: (client, o) => createBill(client, readSpec(o), { dryRun: Boolean(o["dry-run"]) }),
    },
    get: {
      usage: "bill get (--number <FY26-000NNN> | --id <billid>)",
      options: { number: { type: "string" }, id: { type: "string" } },
      run: (client, o) => {
        if (!o.number === !o.id) throw new UsageError("Give exactly one of --number or --id");
        return getBill(client, { billNumber: o.number, billid: o.id });
      },
    },
  },
};

// A bill spec comes from a JSON file (--spec) or inline (--json).
function readSpec(o) {
  if (!o.spec === !o.json) throw new UsageError("Give exactly one of --spec <file> or --json '<spec>'");
  const text = o.spec ? fs.readFileSync(path.resolve(o.spec), "utf8") : o.json;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UsageError(`Bill spec is not valid JSON: ${e.message}`);
  }
}

function usage() {
  return Object.values(COMMANDS)
    .flatMap((actions) => Object.values(actions).map((a) => `  ${a.usage}`))
    .join("\n");
}

async function main(argv) {
  const [area, action, ...rest] = argv;
  const command = COMMANDS[area]?.[action];
  if (!command) {
    throw new UsageError(`Unknown command "${[area, action].filter(Boolean).join(" ")}". Commands:\n${usage()}`);
  }
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: command.options, strict: true }));
  } catch (e) {
    throw new UsageError(`${e.message}\nUsage: ${command.usage}`);
  }
  const result = await command.run(makeClient(), values);
  process.stdout.write(JSON.stringify(result ?? null, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((err) => {
  const inputError =
    err instanceof UsageError ||
    err instanceof CustomerInputError ||
    err instanceof ManualItemInputError ||
    err instanceof BillInputError;
  process.stderr.write(
    JSON.stringify({ error: err.message, type: err.name || "Error", ...(err.code && { code: err.code }) }) + "\n",
  );
  process.exit(inputError ? 2 : 1);
});
