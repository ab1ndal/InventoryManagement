import { assertEquals } from "@std/assert";
import { checkUpPincode, type PincodeCheck } from "./pincode.ts";

type Row = [pincode: string, lookup: string | null, expected: PincodeCheck];

// R16 table.
const ROWS: Row[] = [
  ["201001", null, { ok: true }], // non-shared prefix accepts on failed lookup
  ["201001", "Uttar Pradesh", { ok: true }],
  ["226001", null, { ok: true }],
  ["248001", null, { ok: false, reason: "unverifiable" }], // shared with Uttarakhand, lookup failed
  ["248001", "Uttarakhand", { ok: false, reason: "not_up" }],
  ["263001", "Uttarakhand", { ok: false, reason: "not_up" }],
  ["263001", null, { ok: false, reason: "unverifiable" }],
  ["247001", "Uttar Pradesh", { ok: true }], // shared prefix, verified UP
  ["244001", null, { ok: false, reason: "unverifiable" }],
  ["246001", null, { ok: false, reason: "unverifiable" }],
  ["249001", null, { ok: false, reason: "unverifiable" }],
  ["262001", null, { ok: false, reason: "unverifiable" }],
  ["262001", "uttar pradesh", { ok: true }],
  ["201001", "Delhi", { ok: false, reason: "not_up" }], // lookup wins over prefix
  ["110001", "Delhi", { ok: false, reason: "not_up" }], // prefix 11
  ["290001", null, { ok: false, reason: "not_up" }], // prefix 29
  ["200001", null, { ok: true }], // prefix 20 boundary
  ["285001", null, { ok: true }], // prefix 28 boundary
  ["19999", null, { ok: false, reason: "format" }],
  ["2010011", null, { ok: false, reason: "format" }],
  ["20100a", null, { ok: false, reason: "format" }],
  ["", null, { ok: false, reason: "format" }],
  [" 201001 ", null, { ok: true }],
];

for (const [pincode, lookup, expected] of ROWS) {
  Deno.test(`checkUpPincode(${JSON.stringify(pincode)}, lookup=${lookup}) → ${JSON.stringify(expected)}`, async () => {
    assertEquals(await checkUpPincode(pincode, () => Promise.resolve(lookup)), expected);
  });
}

Deno.test("no lookup for a bad format or a non-UP prefix", async () => {
  const seen: string[] = [];
  const lookup = (p: string) => {
    seen.push(p);
    return Promise.resolve("Uttar Pradesh");
  };
  await checkUpPincode("12345", lookup);
  await checkUpPincode("400001", lookup);
  assertEquals(seen, []);
  await checkUpPincode(" 201001", lookup);
  assertEquals(seen, ["201001"]);
});
