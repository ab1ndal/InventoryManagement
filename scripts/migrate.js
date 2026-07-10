#!/usr/bin/env node
// Applies schema/migration_*.sql files that haven't been run yet, via the
// `exec_sql` RPC (see schema/util_exec_migration.sql — apply that once
// manually in the Supabase SQL editor first).

const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
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

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const schemaDir = path.join(__dirname, "..", "schema");
  const files = fs
    .readdirSync(schemaDir)
    .filter((f) => f.startsWith("migration_") && f.endsWith(".sql"))
    .sort();

  const appliedRes = await fetch(`${url}/rest/v1/_migrations?select=filename`, { headers });
  if (!appliedRes.ok) {
    const body = await appliedRes.text();
    console.error("Could not read _migrations table. Run schema/util_exec_migration.sql in the Supabase SQL editor first.");
    console.error(body);
    process.exit(1);
  }
  const applied = new Set((await appliedRes.json()).map((r) => r.filename));

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log("No pending migrations.");
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(schemaDir, file), "utf8");
    console.log(`Applying ${file}...`);

    const execRes = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: sql }),
    });
    if (!execRes.ok) {
      console.error(`Failed: ${file}`);
      console.error(await execRes.text());
      process.exit(1);
    }

    const recordRes = await fetch(`${url}/rest/v1/_migrations`, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ filename: file }),
    });
    if (!recordRes.ok) {
      console.error(`Applied ${file} but failed to record it:`);
      console.error(await recordRes.text());
      process.exit(1);
    }

    console.log(`  done`);
  }

  console.log(`Applied ${pending.length} migration(s).`);
}

main();
