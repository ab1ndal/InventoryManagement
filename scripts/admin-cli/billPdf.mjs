/**
 * `bill pdf`: makes a finalized bill's PDF with the admin app itself.
 *
 * The app draws the PDF in the browser (InvoiceView → html2canvas → jsPDF, see
 * src/admin/components/billing/useBillPdf.js), so a copy of that layout in Node would
 * drift from what the shop prints. Instead this opens the deployed admin Bills screen in
 * headless Chrome, signed in with the CLI's own admin session, and clicks the bill's
 * "Regenerate PDF" button. Success is judged by the database (bills.pdf_url changed),
 * not by the screen.
 */
import { chromium } from "playwright";
import { isCancelled, isLiveSale } from "../../src/admin/lib/billStatus.js";

export const DEFAULT_APP_URL = "https://www.bindalscreations.com";
const STEP_TIMEOUT_MS = 60_000;

export class BillPdfError extends Error {
  constructor(message) {
    super(message);
    this.name = "BillPdfError";
  }
}

/** The localStorage entry the app's supabase-js client restores its session from (default key). */
export function browserSessionEntry(supabaseUrl, session) {
  return {
    key: `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`,
    value: JSON.stringify(session),
  };
}

async function readBill(client, billid) {
  const { data, error } = await client
    .from("bills")
    .select("billid, bill_number, finalized, paymentstatus, pdf_url")
    .eq("billid", billid)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new BillPdfError(`No bill with id ${billid}`);
  return data;
}

/**
 * Regenerates the bill's PDF through the admin app and returns the new storage path.
 * `onSessionRotated` gets the browser's session if the app refreshed it: Supabase rotates
 * refresh tokens, so the CLI must keep the new one or its next command is logged out.
 */
export async function regenerateBillPdf({ client, supabaseUrl, appUrl = DEFAULT_APP_URL, billid, onSessionRotated }) {
  const before = await readBill(client, billid);
  // A cancelled bill keeps finalized, and the PDF layout has no cancelled mark, so a new PDF
  // would print it as a valid sale.
  if (isCancelled(before)) throw new BillPdfError(`Bill ${before.bill_number ?? billid} is cancelled; a cancelled bill gets no new PDF`);
  if (!isLiveSale(before)) throw new BillPdfError(`Bill ${before.bill_number ?? billid} is not finalized; only finalized bills have a PDF`);

  const { data: auth, error: authErr } = await client.auth.getSession();
  if (authErr || !auth.session) throw new Error(`No CLI session to hand to the browser (${authErr?.message ?? "none"})`);
  const entry = browserSessionEntry(supabaseUrl, auth.session);

  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch (e) {
    throw new Error(`Could not start Google Chrome for the PDF (${e.message.split("\n")[0]}). Install Chrome, or run: npx playwright install chromium`);
  }
  try {
    const context = await browser.newContext();
    // Only seed an empty slot, so a reload never overwrites a session the app has since rotated.
    await context.addInitScript(([key, value]) => {
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, value);
    }, [entry.key, entry.value]);
    const page = await context.newPage();
    page.setDefaultTimeout(STEP_TIMEOUT_MS);
    // After regenerating, the app opens the PDF in a new tab; nothing here needs it.
    context.on("page", (p) => { if (p !== page) p.close().catch(() => {}); });

    try {
      await page.goto(new URL("/admin/bills", appUrl).toString());
      const search = page.getByPlaceholder("Search by bill #, customer name, or phone");
      await Promise.race([
        search.waitFor(),
        page.waitForURL(/\/(admin\/login|unauthorized)/).then(() => {
          throw new Error(`The admin app did not accept the CLI session (landed on ${page.url()})`);
        }),
      ]);
      await search.fill(before.bill_number);
      const row = page.locator("tr", { hasText: before.bill_number });
      await row.getByRole("button", { name: "Regenerate PDF" }).click();

      const outcome = page.getByText(new RegExp(`PDF regenerated for Bill #${billid}\\b|PDF generation failed`)).first();
      await outcome.waitFor();
      if ((await outcome.textContent()).includes("failed")) {
        const detail = await page.getByText("PDF generation failed").locator("xpath=..").textContent();
        throw new Error(`The admin app could not make the PDF: ${detail.replace("PDF generation failed", "").trim() || "no detail"}`);
      }
    } finally {
      const stored = await page.evaluate((key) => window.localStorage.getItem(key), entry.key).catch(() => null);
      const session = stored && JSON.parse(stored);
      if (session?.refresh_token && session.refresh_token !== auth.session.refresh_token) onSessionRotated?.(session);
    }
  } finally {
    await browser.close();
  }

  const after = await readBill(client, billid);
  if (!after.pdf_url || after.pdf_url === before.pdf_url) {
    throw new Error(`The app reported success but bill ${before.bill_number} still has pdf_url ${JSON.stringify(after.pdf_url)}`);
  }
  return { billid, bill_number: after.bill_number, pdf_url: after.pdf_url, previous_pdf_url: before.pdf_url };
}
