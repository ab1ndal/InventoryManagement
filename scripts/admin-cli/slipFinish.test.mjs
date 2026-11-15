// node --test scripts/admin-cli/slipFinish.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { finishSlip } from "./slipFinish.mjs";

// What bill create returns for a saved slip: billid and bill number differ, as in prod.
const saved = { billid: 488, bill_number: "FY26-000415", status: "finalized", slip_photos: [{ id: "p1" }], warnings: [] };
const steps = (over = {}) => {
  const calls = [];
  return {
    calls,
    spec: { date: "2026-10-22" },
    create: async () => (calls.push(["create"]), over.created ?? saved),
    pdf: async (number) => {
      calls.push(["pdf", number]);
      if (over.pdfError) throw new Error(over.pdfError);
      return { pdf_url: "https://x/invoices/FY26-000415.pdf" };
    },
    get: async (number) => (calls.push(["get", number]), over.bill === undefined ? { bill_number: number } : over.bill),
    check: (spec, bill) => (calls.push(["check", spec, bill.bill_number]), over.check ?? { ok: true, mismatches: [], saved: {} }),
  };
};

test("makes the PDF and reads the bill back by its number, never its id", async () => {
  const s = steps();
  const out = await finishSlip(s);
  assert.deepEqual(s.calls, [["create"], ["pdf", "FY26-000415"], ["get", "FY26-000415"], ["check", { date: "2026-10-22" }, "FY26-000415"]]);
  assert.deepEqual(out, {
    billid: 488,
    bill_number: "FY26-000415",
    status: "finalized",
    pdf_url: "https://x/invoices/FY26-000415.pdf",
    slip_photos: ["p1"],
    verify: { ok: true, mismatches: [], saved: {} },
    ok: true,
  });
});

test("a bill that differs from the spec is not ok", async () => {
  const out = await finishSlip(steps({ check: { ok: false, mismatches: ["total: spec 1800, bill 1700"], saved: {} } }));
  assert.equal(out.ok, false);
  assert.deepEqual(out.verify.mismatches, ["total: spec 1800, bill 1700"]);
});

test("a failed PDF keeps the bill, says how to retry, and still checks it", async () => {
  const s = steps({ pdfError: "PDF generation failed" });
  const out = await finishSlip(s);
  assert.equal(out.pdf_error, "PDF generation failed");
  assert.equal(out.pdf_retry, "bill pdf --number FY26-000415");
  assert.equal(out.verify.ok, true);
  assert.equal(out.ok, false);
});

test("a draft gets no PDF", async () => {
  const s = steps({ created: { ...saved, status: "draft" } });
  const out = await finishSlip(s);
  assert.equal(s.calls.some(([c]) => c === "pdf"), false);
  assert.match(out.pdf, /^skipped/);
  assert.equal(out.ok, true);
});

test("carries photo and save problems through, and they make it not ok", async () => {
  const errors = [{ file: "319.jpeg", error: "boom", retry: "slip add --id 488 --file \"319.jpeg\"" }];
  const out = await finishSlip(steps({ created: { ...saved, slip_photos: [], slip_photo_errors: errors } }));
  assert.deepEqual(out.slip_photo_errors, errors);
  assert.equal(out.ok, false);
});

test("a bill missing after the save is a mismatch", async () => {
  const out = await finishSlip(steps({ bill: null }));
  assert.deepEqual(out.verify, { ok: false, mismatches: ["bill FY26-000415 not found after saving"] });
  assert.equal(out.ok, false);
});

test("a dry run is bill create's dry run and nothing else", async () => {
  const preview = { dry_run: true, slip_photos: [{ file: "319.jpeg", upload_bytes: 1 }] };
  const s = steps({ created: preview });
  assert.deepEqual(await finishSlip({ ...s, dryRun: true }), preview);
  assert.deepEqual(s.calls, [["create"]]);
});
