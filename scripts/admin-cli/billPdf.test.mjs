// node --test scripts/admin-cli/billPdf.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { browserSessionEntry, regenerateBillPdf, BillPdfError } from "./billPdf.mjs";

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

// The bill row regenerateBillPdf reads first; it must refuse before starting a browser.
const clientFor = (bill) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: bill, error: null }) }) }) }),
});

test("refuses a cancelled bill, which keeps finalized but must not print as a sale", async () => {
  const bill = { billid: 5, bill_number: "FY26-000005", finalized: true, paymentstatus: "cancelled", pdf_url: "x.pdf" };
  await assert.rejects(regenerateBillPdf({ client: clientFor(bill), supabaseUrl: "https://x.supabase.co", billid: 5 }),
    (e) => e instanceof BillPdfError && /FY26-000005 is cancelled/.test(e.message));
});

test("refuses a draft", async () => {
  const bill = { billid: 6, bill_number: "FY26-000006", finalized: false, paymentstatus: "draft", pdf_url: null };
  await assert.rejects(regenerateBillPdf({ client: clientFor(bill), supabaseUrl: "https://x.supabase.co", billid: 6 }),
    (e) => e instanceof BillPdfError && /is not finalized/.test(e.message));
});
