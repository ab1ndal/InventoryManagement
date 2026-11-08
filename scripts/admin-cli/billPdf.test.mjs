// node --test scripts/admin-cli/billPdf.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { browserSessionEntry } from "./billPdf.mjs";

test("uses the same localStorage key the app's supabase-js client reads", () => {
  const url = "https://abcdefghijklmnop.supabase.co";
  const appClient = createClient(url, "anon-key");
  const { key } = browserSessionEntry(url, { access_token: "a" });
  assert.equal(key, "sb-abcdefghijklmnop-auth-token");
  assert.equal(key, appClient.auth.storageKey);
});

test("stores the whole session as JSON so the app can restore user and expiry", () => {
  const session = { access_token: "a", refresh_token: "r", expires_at: 1, user: { id: "u" } };
  assert.deepEqual(JSON.parse(browserSessionEntry("https://x.supabase.co", session).value), session);
});
