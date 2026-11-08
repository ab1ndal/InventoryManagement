#!/usr/bin/env node
/**
 * Command-line access to admin features (customers, products, bills, slip photos), for
 * entering and auditing data without the admin screens. Thin wrapper: all
 * rules live in the shared modules under src/admin/lib/.
 *
 *   node scripts/admin-cli.mjs login --email <you>     (once, in a terminal)
 *   node scripts/admin-cli.mjs <area> <action> [--options]
 *
 * Success: JSON on stdout, exit 0. Failure: {"error","type"} JSON on stderr,
 * exit 2 for bad input, 3 for not logged in / not an admin, 1 for anything
 * else. Every write accepts --dry-run.
 * Security: no service-role key. Commands run as the logged-in admin with the
 * public anon key, under the same RLS and admin-role check as the admin app
 * (see scripts/admin-cli/session.mjs). Guide: docs/admin-cli.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { authedClient, login, logout, promptHidden, sessionPath, writeSession, AuthError } from "./admin-cli/session.mjs";
import { shrinkSlipPhoto, SlipFileError } from "./admin-cli/slipPhoto.mjs";
import { regenerateBillPdf, BillPdfError, DEFAULT_APP_URL } from "./admin-cli/billPdf.mjs";

// src/ is untyped ESM shared with CRA; marking it "type": "module" would force
// extensionful imports on the whole app. Node warns when loading it, so drop
// only that warning (before the dynamic import below) to keep stderr clean.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.error(w);
});
const { findCustomerByPhone, findCustomersByName, createCustomer, CustomerInputError } = await import(
  "../src/admin/lib/customers.js"
);
const { findProducts, searchProducts, listCategories, ProductInputError } = await import(
  "../src/admin/lib/products.js"
);
const { findManualItems, createManualItem, ManualItemInputError } = await import(
  "../src/admin/lib/manualItems.js"
);
const { addStockByCode, VariantInputError } = await import("../src/admin/lib/variants.js");
const { prepareBill, createBill, getBill, findBills, BillInputError } = await import(
  "../src/admin/lib/bills.js"
);
const { listSlipPhotos, addSlipPhoto, downloadSlipPhoto, SlipPhotoInputError, MAX_SLIP_BYTES } = await import(
  "../src/admin/lib/billSlipPhotos.js"
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

// Only the public project URL and anon key are read from .env.
function supabaseConfig() {
  const env = { ...loadEnv(), ...process.env };
  return { url: env.REACT_APP_SUPABASE_URL, anonKey: env.REACT_APP_SUPABASE_ANON_KEY };
}

// Session commands: no admin client needed (login creates the session).
const SESSION_COMMANDS = {
  login: {
    usage: "login --email <email>   (prompts for the password; run in your own terminal)",
    options: { email: { type: "string" } },
    run: async (o) => {
      if (!o.email) throw new UsageError("--email is required");
      const password = await promptHidden(`Password for ${o.email}: `);
      return login({ ...supabaseConfig(), email: o.email, password });
    },
  },
  logout: {
    usage: "logout",
    options: {},
    run: () => logout(supabaseConfig()),
  },
  whoami: {
    usage: "whoami",
    options: {},
    run: async () => (await authedClient(supabaseConfig())).user,
  },
};

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS = {
  customer: {
    find: {
      usage: "customer find (--phone <phone> | --name <words>)",
      options: { phone: { type: "string" }, name: { type: "string" } },
      run: (client, o) => {
        if (!o.phone === !o.name) throw new UsageError("Give exactly one of --phone or --name");
        return o.phone ? findCustomerByPhone(client, o.phone) : findCustomersByName(client, o.name);
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
    search: {
      usage:
        "product search [--name <text>] [--category <id>] [--cost <Z-code|amount>] [--mrp <amount>] [--color <text>] [--in-stock]",
      options: {
        name: { type: "string" },
        category: { type: "string" },
        cost: { type: "string" },
        mrp: { type: "string" },
        color: { type: "string" },
        "in-stock": { type: "boolean" },
      },
      run: (client, o) =>
        searchProducts(client, {
          name: o.name,
          categoryid: o.category,
          cost: o.cost,
          mrp: o.mrp,
          color: o.color,
          inStock: Boolean(o["in-stock"]),
        }),
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
  stock: {
    add: {
      usage:
        "stock add --code <product code> --size <size> --color <colour> --qty <n> [--new-variant] [--dry-run]",
      options: {
        code: { type: "string" },
        size: { type: "string" },
        color: { type: "string" },
        qty: { type: "string" },
        "new-variant": { type: "boolean" },
        "dry-run": { type: "boolean" },
      },
      run: (client, o) => {
        if (!o.code) throw new UsageError("--code is required");
        if (o.qty === undefined) throw new UsageError("--qty is required");
        return addStockByCode(
          client,
          {
            code: o.code,
            size: o.size,
            color: o.color,
            quantity: o.qty,
            allowNewVariant: Boolean(o["new-variant"]),
          },
          { dryRun: Boolean(o["dry-run"]) },
        );
      },
    },
  },
  bill: {
    preview: {
      usage: "bill preview (--spec <file.json> | --json '<spec>')",
      options: { spec: { type: "string" }, json: { type: "string" } },
      run: (client, o) => prepareBill(client, readSpec(o)),
    },
    create: {
      usage: "bill create (--spec <file.json> | --json '<spec>') [--photo <slip photo>]... [--dry-run]",
      options: {
        spec: { type: "string" },
        json: { type: "string" },
        photo: { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
      },
      run: async (client, o) => {
        // Shrink and check photos first, so a bad photo stops before the bill is written.
        const photos = shrinkSlipPhotos(o.photo);
        const result = await createBill(client, readSpec(o), { dryRun: Boolean(o["dry-run"]) });
        if (o["dry-run"]) return { ...result, slip_photos: photos.map(describeShrunk) };
        return { ...result, ...(await attachSlipPhotos(client, result.billid, photos)) };
      },
    },
    find: {
      usage:
        "bill find [--customer <id>] [--phone <phone>] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>] [--product <code>]",
      options: {
        customer: { type: "string" },
        phone: { type: "string" },
        from: { type: "string" },
        to: { type: "string" },
        product: { type: "string" },
      },
      run: (client, o) =>
        findBills(client, {
          customerid: o.customer,
          phone: o.phone,
          from: o.from,
          to: o.to,
          productCode: o.product,
        }),
    },
    get: {
      usage: "bill get (--number <FY26-000NNN> | --id <billid>)",
      options: { number: { type: "string" }, id: { type: "string" } },
      run: (client, o) => {
        if (!o.number === !o.id) throw new UsageError("Give exactly one of --number or --id");
        return getBill(client, { billNumber: o.number, billid: o.id });
      },
    },
    pdf: {
      usage: "bill pdf (--number <FY26-000NNN> | --id <billid>) [--app-url <admin app origin>]   (needs Google Chrome)",
      options: { number: { type: "string" }, id: { type: "string" }, "app-url": { type: "string" } },
      run: async (client, o) =>
        regenerateBillPdf({
          client,
          supabaseUrl: supabaseConfig().url,
          appUrl: o["app-url"] ?? DEFAULT_APP_URL,
          billid: await billIdFrom(client, o),
          onSessionRotated: (session) => writeSession(sessionPath(), session),
        }),
    },
  },
  slip: {
    add: {
      usage: "slip add (--number <FY26-000NNN> | --id <billid>) --file <slip photo>... [--dry-run]",
      options: {
        number: { type: "string" },
        id: { type: "string" },
        file: { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
      },
      run: async (client, o) => {
        if (!o.file?.length) throw new UsageError("--file is required");
        const billid = await billIdFrom(client, o);
        const photos = shrinkSlipPhotos(o.file);
        if (o["dry-run"]) return { dry_run: true, billid, slip_photos: photos.map(describeShrunk) };
        return { billid, ...(await attachSlipPhotos(client, billid, photos)) };
      },
    },
    list: {
      usage: "slip list (--number <FY26-000NNN> | --id <billid>)",
      options: { number: { type: "string" }, id: { type: "string" } },
      run: async (client, o) => listSlipPhotos(client, await billIdFrom(client, o)),
    },
    download: {
      usage: "slip download --photo <photo id> [--out <folder>]   (saves <photo id>.jpg)",
      options: { photo: { type: "string" }, out: { type: "string" } },
      run: async (client, o) => {
        if (!o.photo) throw new UsageError("--photo is required");
        const found = await downloadSlipPhoto(client, o.photo);
        if (!found) throw new UsageError(`No slip photo ${o.photo}`);
        const file = path.resolve(o.out ?? ".", `${found.photo.id}.jpg`);
        fs.writeFileSync(file, found.bytes);
        return { ...found.photo, file };
      },
    },
  },
};

async function billIdFrom(client, o) {
  if (!o.number === !o.id) throw new UsageError("Give exactly one of --number or --id");
  if (o.id) return Number(o.id);
  const { data, error } = await client
    .from("bills")
    .select("billid")
    .eq("bill_number", o.number.trim().toUpperCase())
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new UsageError(`No bill numbered ${o.number}`);
  return data.billid;
}

function shrinkSlipPhotos(files = []) {
  const photos = files.map(shrinkSlipPhoto);
  const tooBig = photos.find((p) => p.size > MAX_SLIP_BYTES);
  if (tooBig) {
    throw new SlipPhotoInputError(`${tooBig.source} is still over 2 MB after shrinking (${tooBig.size} bytes)`);
  }
  return photos;
}

const describeShrunk = (p) => ({ file: p.source, upload_bytes: p.size });

// The bill already exists here, so a failed photo is reported, not thrown, with the command
// that retries it; the exit code is still 1 so a script notices.
async function attachSlipPhotos(client, billid, photos) {
  const slip_photos = [];
  const slip_photo_errors = [];
  for (const p of photos) {
    try {
      slip_photos.push({ ...(await addSlipPhoto(client, billid, p)), file: p.source });
    } catch (e) {
      slip_photo_errors.push({ file: p.source, error: e.message, retry: `slip add --id ${billid} --file ${JSON.stringify(p.source)}` });
    }
  }
  if (slip_photo_errors.length) process.exitCode = 1;
  return { slip_photos, ...(slip_photo_errors.length && { slip_photo_errors }) };
}

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
  return [
    ...Object.values(SESSION_COMMANDS).map((c) => `  ${c.usage}`),
    ...Object.values(COMMANDS).flatMap((actions) => Object.values(actions).map((a) => `  ${a.usage}`)),
  ].join("\n");
}

function parseOptions(command, args) {
  try {
    return parseArgs({ args, options: command.options, strict: true }).values;
  } catch (e) {
    throw new UsageError(`${e.message}\nUsage: ${command.usage}`);
  }
}

async function main(argv) {
  const [area, action, ...rest] = argv;
  const print = (result) => process.stdout.write(JSON.stringify(result ?? null, null, 2) + "\n");

  const sessionCommand = Object.hasOwn(SESSION_COMMANDS, area) ? SESSION_COMMANDS[area] : null;
  if (sessionCommand) {
    return print(await sessionCommand.run(parseOptions(sessionCommand, argv.slice(1))));
  }
  const command = Object.hasOwn(COMMANDS, area) && Object.hasOwn(COMMANDS[area], action) ? COMMANDS[area][action] : null;
  if (!command) {
    throw new UsageError(`Unknown command "${[area, action].filter(Boolean).join(" ")}". Commands:\n${usage()}`);
  }
  const values = parseOptions(command, rest);
  const { client } = await authedClient(supabaseConfig());
  print(await command.run(client, values));
}

main(process.argv.slice(2)).catch((err) => {
  const inputError =
    err instanceof UsageError ||
    err instanceof CustomerInputError ||
    err instanceof ManualItemInputError ||
    err instanceof ProductInputError ||
    err instanceof VariantInputError ||
    err instanceof BillInputError ||
    err instanceof SlipPhotoInputError ||
    err instanceof BillPdfError ||
    err instanceof SlipFileError;
  process.stderr.write(
    JSON.stringify({ error: err.message, type: err.name || "Error", ...(err.code && { code: err.code }) }) + "\n",
  );
  process.exit(err instanceof AuthError ? 3 : inputError ? 2 : 1);
});
