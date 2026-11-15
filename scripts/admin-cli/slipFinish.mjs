// `slip finish`: a previewed slip in one command. bill create (with the slip photo), then bill pdf
// by the new bill's NUMBER (a bill id passed as a number once regenerated the wrong bill's PDF),
// then bill get, and a check of the saved bill against the spec. The steps are the CLI's own
// commands, passed in, so this only orders them and reports.

/**
 * Returns the compact result; `ok` is false when the saved bill differs from the spec or a step
 * after the save failed (the caller exits non-zero). A step after the save never undoes the bill:
 * it is reported with the command that retries it.
 */
export async function finishSlip({ spec, dryRun = false, create, pdf, get, check }) {
  const created = await create();
  if (dryRun) return created;

  const number = created.bill_number;
  const out = { billid: created.billid, bill_number: number, status: created.status };
  if (created.status === "draft") {
    out.pdf = "skipped: a draft has no PDF until it is finished on the Billing screen";
  } else {
    try {
      out.pdf_url = (await pdf(number)).pdf_url;
    } catch (e) {
      out.pdf_error = e.message;
      out.pdf_retry = `bill pdf --number ${number}`;
    }
  }
  out.slip_photos = (created.slip_photos ?? []).map((p) => p.id);
  if (created.slip_photo_errors) out.slip_photo_errors = created.slip_photo_errors;
  if (created.save_errors) out.save_errors = created.save_errors;
  if (created.stock_adds) out.stock_adds = created.stock_adds.map((a) => `${a.productid} ${a.color}/${a.size} +${a.qty}`);
  if (created.negative_stock?.length) out.negative_stock = created.negative_stock;
  if (created.warnings?.length) out.warnings = created.warnings;

  const bill = await get(number);
  out.verify = bill ? check(spec, bill) : { ok: false, mismatches: [`bill ${number} not found after saving`] };
  out.ok = out.verify.ok && !out.pdf_error && !out.slip_photo_errors && !out.save_errors && !out.negative_stock;
  return out;
}
