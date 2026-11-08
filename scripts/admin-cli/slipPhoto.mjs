// Shrinks a slip photo for upload with macOS's built-in sips, so the CLI needs no image
// library. sips also reads iPhone HEIC. Same long side as the billing screen
// (SLIP_MAX_SIDE_PX in src/admin/components/billing/BillSlipPhotos.jsx).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SLIP_MAX_SIDE_PX = 2000;
const JPEG_QUALITY_PERCENT = 82;

export class SlipFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "SlipFileError";
  }
}

/** { body, contentType, size, source } ready for addSlipPhoto. */
export function shrinkSlipPhoto(file) {
  const source = path.resolve(file);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new SlipFileError(`Slip photo not found: ${file}`);
  }
  if (process.platform !== "darwin") {
    throw new SlipFileError("Shrinking slip photos uses macOS sips; run this on a Mac");
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bill-slip-"));
  const out = path.join(dir, "slip.jpg");
  try {
    execFileSync(
      "sips",
      ["-Z", String(SLIP_MAX_SIDE_PX), "-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY_PERCENT), source, "--out", out],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const body = fs.readFileSync(out);
    return { body, contentType: "image/jpeg", size: body.length, source };
  } catch (e) {
    throw new SlipFileError(`Could not read ${file} as a photo: ${(e.stderr?.toString() || e.message).trim()}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
