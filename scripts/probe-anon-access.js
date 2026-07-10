#!/usr/bin/env node
// Regression probe: anon must NOT be able to read cost/margin data.
// Exits 0 if locked down, 1 if any cost data leaks.
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

async function main() {
  const env = { ...loadEnv(), ...process.env };
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or REACT_APP_SUPABASE_ANON_KEY");
    process.exit(2);
  }
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let failed = false;

  // 1. Direct products.purchaseprice must be denied (not just empty rows).
  const r1 = await fetch(`${url}/rest/v1/products?select=productid,purchaseprice&limit=1`, { headers });
  const b1 = await r1.text();
  if (r1.ok && b1.includes("purchaseprice")) {
    console.error("LEAK: anon read products.purchaseprice directly ->", b1.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: products.purchaseprice denied to anon");
  }

  // 2. mockups_view must be denied to anon entirely.
  const r2 = await fetch(`${url}/rest/v1/mockups_view?select=productid,purchaseprice&limit=1`, { headers });
  const b2 = await r2.text();
  if (r2.ok && b2.includes("purchaseprice")) {
    console.error("LEAK: anon read mockups_view.purchaseprice ->", b2.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: mockups_view denied to anon");
  }

  // 3. Sanity: anon MUST still read safe catalog columns (storefront depends on it).
  const r3 = await fetch(`${url}/rest/v1/products?select=productid,name,retailprice&limit=1`, { headers });
  const b3 = await r3.text();
  if (!(r3.ok && b3.includes("retailprice"))) {
    console.error("BROKEN: anon can no longer read safe catalog columns ->", r3.status, b3.slice(0, 200));
    failed = true;
  } else {
    console.log("OK: anon still reads safe catalog columns");
  }

  process.exit(failed ? 1 : 0);
}
main();
