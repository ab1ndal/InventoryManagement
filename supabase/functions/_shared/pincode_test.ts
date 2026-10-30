import { assertEquals } from "@std/assert";
import { checkPincode, type PincodeCheck } from "./pincode.ts";

type Row = [pincode: string, lookup: string | null, expected: { ok: true; inUp: boolean } | { ok: false; reason: "format" }];

// R16 table: every valid pincode is accepted; only `inUp` varies.
const ROWS: Row[] = [
  ["201001", null, { ok: true, inUp: true }], // non-shared prefix counts as UP on failed lookup
  ["201001", "Uttar Pradesh", { ok: true, inUp: true }],
  ["226001", null, { ok: true, inUp: true }],
  ["248001", null, { ok: true, inUp: false }], // shared with Uttarakhand, lookup failed
  ["248001", "Uttarakhand", { ok: true, inUp: false }],
  ["263001", "Uttarakhand", { ok: true, inUp: false }],
  ["263001", null, { ok: true, inUp: false }],
  ["247001", "Uttar Pradesh", { ok: true, inUp: true }], // shared prefix, verified UP
  ["244001", null, { ok: true, inUp: false }],
  ["246001", null, { ok: true, inUp: false }],
  ["249001", null, { ok: true, inUp: false }],
  ["262001", null, { ok: true, inUp: false }],
  ["262001", "uttar pradesh", { ok: true, inUp: true }],
  ["201001", "Delhi", { ok: true, inUp: false }], // lookup wins over prefix
  ["110001", "Delhi", { ok: true, inUp: false }], // prefix 11
  ["400001", null, { ok: true, inUp: false }],
  ["290001", null, { ok: true, inUp: false }], // prefix 29
  ["200001", null, { ok: true, inUp: true }], // prefix 20 boundary
  ["285001", null, { ok: true, inUp: true }], // prefix 28 boundary
  ["19999", null, { ok: false, reason: "format" }],
  ["2010011", null, { ok: false, reason: "format" }],
  ["20100a", null, { ok: false, reason: "format" }],
  ["012345", null, { ok: false, reason: "format" }], // no pincode starts with 0
  ["", null, { ok: false, reason: "format" }],
  [" 201001 ", null, { ok: true, inUp: true }],
];

for (const [pincode, lookup, expected] of ROWS) {
  Deno.test(`checkPincode(${JSON.stringify(pincode)}, lookup=${lookup}) → ${JSON.stringify(expected)}`, async () => {
    const details = lookup === null ? null : { state: lookup, city: null };
    const want: PincodeCheck = expected.ok ? { ...expected, city: null, state: lookup } : expected;
    assertEquals(await checkPincode(pincode, () => Promise.resolve(details)), want);
  });
}

Deno.test("lookup runs for every valid pincode (autofill), never for a bad format", async () => {
  const seen: string[] = [];
  const lookup = (p: string) => {
    seen.push(p);
    return Promise.resolve({ state: "Maharashtra", city: "Mumbai" });
  };
  assertEquals(await checkPincode("12345", lookup), { ok: false, reason: "format" });
  assertEquals(seen, []);
  // Outside 20–28 the lookup only supplies city/state; the prefix still decides inUp.
  assertEquals(await checkPincode("400001", lookup), { ok: true, inUp: false, city: "Mumbai", state: "Maharashtra" });
  await checkPincode(" 201001", lookup);
  assertEquals(seen, ["400001", "201001"]);
});

Deno.test("no lookup configured → city and state null, inUp from the prefix", async () => {
  assertEquals(await checkPincode("110001", () => Promise.resolve(null)), { ok: true, inUp: false, city: null, state: null });
});
