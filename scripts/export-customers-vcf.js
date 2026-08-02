#!/usr/bin/env node
// Exports opted-in customers as vCard files for import into the admin phone's
// contacts, so they can be added to the WhatsApp Community.
//
// WhatsApp exposes no API for adding Community members, so seeding is manual:
// import these contacts, then add them in the app. Output is split into batches
// because the add-participants picker is unwieldy past a few dozen at a time.
//
// Contacts are named with a "BC " prefix so store contacts stay distinguishable
// from personal ones and can be bulk-removed later.
//
//   node scripts/export-customers-vcf.js [--batch-size=50] [--out=dir] [--all]
//
// By default customers already marked as community members are skipped, so
// re-running after a partial seed only exports who is left.

const fs = require("fs");
const path = require("path");

const CONTACT_PREFIX = "BC ";

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

function parseArgs(argv) {
  const args = { batchSize: 50, out: "vcf-export", all: false, link: "[GROUP LINK]", web: false, emoji: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--all") args.all = true;
    else if (arg === "--web") args.web = true;
    else if (arg === "--emoji") args.emoji = true;
    else if (arg.startsWith("--batch-size=")) args.batchSize = Number(arg.split("=")[1]);
    else if (arg.startsWith("--out=")) args.out = arg.split("=")[1];
    else if (arg.startsWith("--link=")) args.link = arg.split("=").slice(1).join("=");
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    console.error("--batch-size must be a positive integer");
    process.exit(1);
  }
  return args;
}

// E.164: leading +, country code, 7-14 further digits. Indian mobiles must be
// +91 followed by exactly 10 digits -- shorter ones are data-entry errors that
// WhatsApp will silently fail to match, so they are reported, not exported.
function validatePhone(raw) {
  const phone = raw.replace(/[\s()-]/g, "");
  if (!/^\+\d{8,15}$/.test(phone)) return { ok: false, reason: "not E.164" };
  if (phone.startsWith("+91") && phone.length !== 13) {
    return { ok: false, reason: `+91 needs 10 digits, has ${phone.length - 3}` };
  }
  return { ok: true, phone };
}

// vCard 3.0 escaping: backslash, comma, semicolon, newline are structural.
function escapeVCard(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function toVCard(customer, phone) {
  const first = (customer.first_name || "").trim();
  const last = (customer.last_name || "").trim();
  const display = `${CONTACT_PREFIX}${[first, last].filter(Boolean).join(" ")}`.trim();
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeVCard(last)};${escapeVCard(CONTACT_PREFIX + first)};;;`,
    `FN:${escapeVCard(display)}`,
    `TEL;TYPE=CELL:${phone}`,
    `NOTE:${escapeVCard(`customerid ${customer.customerid}`)}`,
    "END:VCARD",
  ].join("\r\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const env = { ...loadEnv(), ...process.env };
  const url = env.REACT_APP_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(1);
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  const select = "customerid,first_name,last_name,phone,marketing_opt_in,community_status";
  const filters = ["marketing_opt_in=eq.true", "phone=not.is.null"];
  if (!args.all) filters.push("community_status=in.(not_added,invite_pending)");

  const res = await fetch(
    `${url}/rest/v1/customers?select=${select}&${filters.join("&")}&order=customerid`,
    { headers }
  );

  if (!res.ok) {
    console.error(`Supabase returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  const customers = await res.json();

  // Order by how recently each customer last bought. Adding people to a
  // WhatsApp Community is safest when they recognise the number, so the most
  // recent buyers go in batch 1 and the coldest contacts go last -- if adds
  // start drawing exits or reports, the damage is capped to the cold tail.
  const billsRes = await fetch(
    `${url}/rest/v1/bills?select=customerid,orderdate,bill_items(product_name)&finalized=is.true`,
    { headers }
  );
  if (!billsRes.ok) {
    console.error(`Supabase returned ${billsRes.status}: ${await billsRes.text()}`);
    process.exit(1);
  }

  // What each customer last bought, for the outreach list. Customers may not
  // recall the shop by name -- one of many they visit -- so a message that
  // names their actual purchase does the remembering for them.
  // Items must come from the MOST RECENT bill, not from all bills pooled.
  // Pooling them lets the message pair one purchase's item with another
  // purchase's month -- "aapne July mein shirt liya tha" when the shirt was
  // bought in March. A wrong detail is worse than no detail.
  const lastBill = new Map();
  const history = new Map();
  for (const bill of await billsRes.json()) {
    if (!bill.customerid || !bill.orderdate) continue;
    const ts = Date.parse(bill.orderdate);
    if (Number.isNaN(ts)) continue;

    const prior = history.get(bill.customerid);
    const items = (bill.bill_items ?? []).map((i) => i.product_name).filter(Boolean);

    if (!prior) {
      history.set(bill.customerid, { ts, items: [...new Set(items)], billCount: 1 });
    } else {
      prior.billCount += 1;
      if (ts > prior.ts) {
        prior.ts = ts;
        prior.items = [...new Set(items)];
      }
    }
    if (!lastBill.has(bill.customerid) || ts > lastBill.get(bill.customerid)) {
      lastBill.set(bill.customerid, ts);
    }
  }

  // Never-billed customers sort last, not first, so they land in the final batch.
  customers.sort(
    (a, b) => (lastBill.get(b.customerid) ?? -Infinity) - (lastBill.get(a.customerid) ?? -Infinity)
  );

  const valid = [];
  const invalid = [];

  for (const customer of customers) {
    const result = validatePhone(customer.phone);
    if (result.ok) valid.push({ customer, phone: result.phone, lastBill: lastBill.get(customer.customerid) });
    else invalid.push({ customer, reason: result.reason });
  }

  if (!valid.length) {
    console.log("Nothing to export.");
    if (invalid.length) reportInvalid(invalid);
    return;
  }

  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const batches = [];
  for (let i = 0; i < valid.length; i += args.batchSize) {
    batches.push(valid.slice(i, i + args.batchSize));
  }

  const width = String(batches.length).length;
  batches.forEach((batch, i) => {
    const name = `customers-batch-${String(i + 1).padStart(width, "0")}.vcf`;
    const body = batch.map(({ customer, phone }) => toVCard(customer, phone)).join("\r\n");
    fs.writeFileSync(path.join(outDir, name), body + "\r\n", "utf8");
    console.log(`  ${name}  (${batch.length} contacts, ${describeRecency(batch)})`);
  });

  writeOutreachList(path.join(outDir, "outreach-list.csv"), batches, history);
  console.log("  outreach-list.csv  (personalisation reference)");

  const messages = writeMessages(path.join(outDir, "outreach-messages.md"), batches, history, args.link, args.emoji);
  console.log(`  outreach-messages.md  (ready-to-paste, link: ${args.link})`);

  const alreadySent = readSentCsv(outDir);
  writeLinksPage(path.join(outDir, "outreach-links.html"), batches, messages, args.web, args.link, alreadySent);
  if (alreadySent.length) console.log(`  (sent.csv: ${alreadySent.length} already marked sent)`);
  console.log(`  outreach-links.html  (click-to-chat via ${args.web ? "web.whatsapp.com" : "wa.me"})`);

  console.log(
    `\nExported ${valid.length} contacts across ${batches.length} file(s) to ${outDir}`
  );

  if (invalid.length) reportInvalid(invalid);

  console.log(
    "\nNext: AirDrop/email these to the admin phone, import to Contacts, then add\n" +
      "them to the Community in the WhatsApp app. Mark them as members afterwards so\n" +
      "the next run skips them."
  );
}

// WhatsApp's wa.me prefill corrupts anything it treats as emoji -- both
// astral-plane emoji (U+1F64F and friends) and BMP characters that carry an
// emoji presentation variant, such as U+260E telephone. All arrive as U+FFFD.
// Plain geometric shapes survive: U+25B8 and em-dash were both verified
// rendering correctly in the compose box. So the click-to-chat build sticks to
// U+25B8 only, while the copy-paste build keeps real emoji -- pasting bypasses
// the URL and renders them fine.
function buildMessage(recall, link, bmpSafe) {
  const pray = bmpSafe ? "!" : " 🙏";
  const date = bmpSafe ? "▸" : "📅";
  const pin = bmpSafe ? "▸" : "📍";
  const tel = bmpSafe ? "▸" : "📞";
  const smile = bmpSafe ? "" : " 😊";

  // *asterisks* are WhatsApp's own bold markup and are plain ASCII, so they
  // survive the prefill intact. Bold only the urgency and the when/where --
  // bolding more would flatten the emphasis back to nothing.
  return [
    `Namaste${pray} Bindal's Creation (58, Sihani Gate Market, Ghaziabad) se — ${recall}${smile}`,
    "",
    "Aaj humare Festive Pop-Up ka *aakhri din* hai — Raksha Bandhan aur Teej ka naya collection.",
    `${date} *Aaj, Ravivar · 12 Noon – 6 PM*`,
    `${pin} Pop-up sthal: *R-14/84, Raj Nagar, Ghaziabad*`,
    "   (humari dukaan se alag jagah — sirf aaj ke liye)",
    `${tel} +91 98108 73280`,
    "",
    `Naye collection aur offers ke liye humara WhatsApp group join kariye: ${link}`,
  ].join("\n");
}

// The recall clause, scaled to the relationship. A repeat customer told only
// "you bought a shirt in July" is being under-recognised; naming them as a
// regular is both truer and warmer. Items always come from the most recent
// bill, so the month and the goods always agree. Capped at two items -- a
// full receipt reads like a database, not a shopkeeper.
//
// Hindi note: "liya tha" is masculine singular and is not strictly correct for
// feminine items ("saree li thi"). Item gender is not in the schema, and the
// masculine form is near-universal in colloquial Hinglish, so it is used
// throughout. Swap to an invariant phrasing if that grates.
function buildRecall(past, when) {
  if (!past || !past.items.length || !when) {
    return "aapke liye humara naya festive collection aaya hai";
  }

  // Dedupe AFTER stripping the fabric prefix: "Brocade - Kurta Pajama" and
  // "Cotton - Kurta Pajama" are different products but the same garment to the
  // customer, and listing both yields "kurta pajama aur kurta pajama".
  const all = distinctGarments(past.items);

  // A long basket reads like a receipt if listed in full, but truncating
  // silently to two understates what they actually bought. Name two and
  // acknowledge the rest.
  let goods;
  if (all.length === 1) goods = all[0];
  else if (all.length === 2) goods = `${all[0]} aur ${all[1]}`;
  else goods = `${all[0]}, ${all[1]} aur kuch aur cheezein`;

  const verb = all.length > 1 ? "liye the" : "liya tha";

  if (past.billCount >= 3) {
    return `aap humare regular customer hain — pichhli baar ${when} mein ${goods} ${verb}`;
  }
  return `aapne humse ${when} mein ${goods} ${verb}`;
}

// "Metti Cotton-Suit (3 Pc)" -> "suit (3 pc)". The fabric prefix is shop
// shorthand; customers recognise the garment.
function friendlyItem(productName) {
  // Names are "Fabric - Garment", so split on the FIRST hyphen. Splitting on
  // the last mangles multi-hyphen names: "Brocade - Suit (Jodhpuri) - 3Pc"
  // would reduce to "3pc".
  const i = productName.indexOf("-");
  const tail = i === -1 ? productName : productName.slice(i + 1);
  return tail.trim().toLowerCase().replace(/\s+/g, " ");
}

// "pajama" and "kurta pajama" are different products but naming both is
// redundant to a customer, so drop any garment wholly contained in another.
function distinctGarments(names) {
  const unique = [...new Set(names.map(friendlyItem))];
  return unique.filter(
    (a) => !unique.some((b) => b !== a && b.includes(a) && b.length > a.length)
  );
}

// One ready-to-paste message per customer. Sending is manual 1:1 -- broadcast
// lists only reach people who saved the shop's number, and the Cloud API needs
// an approved marketing template -- so the win available here is removing the
// typing, and varying the text per recipient rather than pasting one identical
// block 197 times.
function writeMessages(file, batches, history, link, emoji) {
  const messages = new Map();
  const out = [
    "# Outreach messages — one per customer, ready to paste",
    "",
    "Manual 1:1 sends. Work down in order: batch 1 is the most recent buyers.",
    "Pace them — spread across the day rather than one burst.",
    "",
  ];

  batches.forEach((batch, i) => {
    out.push(`## Batch ${i + 1} (${batch.length} contacts)`, "");

    for (const { customer, phone, lastBill } of batch) {
      const name = (customer.first_name || "").trim();
      const past = history.get(customer.customerid);
      const when = lastBill
        ? new Date(lastBill).toLocaleDateString("en-IN", { month: "long" })
        : null;

      const recall = buildRecall(past, when);

      // The recall hook must name the SHOP (Sihani Gate) -- that is where the
      // customer actually visited. The pop-up is at a different address in Raj
      // Nagar and is flagged as separate and today-only, or customers will turn
      // up at the wrong place.
      const body = buildMessage(recall, link, false);
      messages.set(customer.customerid, buildMessage(recall, link, !emoji));
      out.push(`### ${name || "(no name)"} — ${phone}`, "", "```", body, "```", "");
    }
  });

  fs.writeFileSync(file, out.join("\n"), "utf8");
  return messages;
}

// Click-to-chat page: one wa.me link per customer, message pre-filled. This is
// WhatsApp's own official feature, not automation -- the send is still a manual
// press, which keeps it within terms and keeps the sending rate human. Cuts the
// per-message effort from roughly 40 seconds to 5.
// Ticks recorded in a previous session, read from <out>/sent.csv if present.
// A file:// page cannot read local files itself (Chrome blocks fetch on file
// URLs), so the durable record is loaded here at generation time instead, and
// the page also offers a manual Load CSV picker.
function readSentCsv(dir) {
  const f = path.join(dir, "sent.csv");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(",")[0].replace(/"/g, "").trim())
    .filter((id) => /^\d+$/.test(id));
}

function writeLinksPage(file, batches, messages, useWeb, link, alreadySent) {
  const esc = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Ticks are namespaced by campaign link, so regenerating for a new campaign
  // starts from a clean slate instead of showing last campaign's progress.
  const total = batches.reduce((n, b) => n + b.length, 0);
  const parts = [
    "<!doctype html>",
    "<html lang='en'><head><meta charset='utf-8'>",
    "<meta name='viewport' content='width=device-width,initial-scale=1'>",
    "<title>Bindal's Creation — outreach</title>",
    `<style>
      body{font:15px/1.5 system-ui,-apple-system,sans-serif;max-width:820px;margin:0 auto;padding:1rem}
      h1{font-size:1.3rem}
      h2{margin:2rem 0 .5rem;padding-top:1rem;border-top:1px solid #ccc;font-size:1rem}
      .bar{position:sticky;top:0;background:#fff;padding:.75rem 0;border-bottom:1px solid #ccc;margin-bottom:1rem}
      .row{display:flex;align-items:baseline;gap:.5rem;padding:.35rem 0;border-bottom:1px solid #f0f0f0}
      .row.done{opacity:.4}
      .row.done .who{text-decoration:line-through}
      .who{font-weight:600;text-decoration:none;color:#0066cc}
      .meta{color:#666;font-size:13px}
      details{margin:.25rem 0 .5rem 1.6rem}
      summary{cursor:pointer;color:#666;font-size:13px}
      pre{white-space:pre-wrap;background:#f6f6f6;padding:.6rem;border-radius:6px;font:14px/1.5 system-ui,sans-serif;margin:.4rem 0}
      button{font:inherit;padding:.3rem .7rem}
      @media (prefers-color-scheme:dark){
        body{background:#151515;color:#eee}
        .bar{background:#151515}
        .who{color:#6db3ff}
        pre{background:#242424}
        h2,.bar{border-color:#333}
        .row{border-color:#242424}
      }
    </style></head><body>`,
    "<h1>Outreach — click a name, review, press send</h1>",
    `<div class="bar"><strong id="count">0 / ${total}</strong> sent &nbsp;
     <button onclick="saveCsv()">Save CSV</button>
     <button onclick="document.getElementById('csvin').click()">Load CSV</button>
     <input id="csvin" type="file" accept=".csv" style="display:none" onchange="loadCsv(this)">
     <button onclick="copySent()">Copy ids</button>
     <button onclick="if(confirm('Clear all ticks?')){localStorage.removeItem(KEY);localStorage.removeItem(LEGACY);location.reload()}">Reset</button></div>`,
    "<p class='meta'>Warmest customers first. Pace the sends — take breaks between batches rather than firing everything at once.</p>",
  ];

  batches.forEach((batch, i) => {
    parts.push(`<h2>Batch ${i + 1} <span class='meta'>(${batch.length})</span></h2>`);
    for (const entry of batch) {
      const { customer, phone } = entry;
      const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
      const body = messages.get(customer.customerid);
      // wa.me hands off to whichever WhatsApp client the OS has registered --
      // usually the desktop app. web.whatsapp.com/send forces the browser
      // session instead, which matters when the app and the browser are logged
      // in as different numbers.
      const digits = phone.replace(/\D/g, "");
      const href = useWeb
        ? `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(body)}`
        : `https://wa.me/${digits}?text=${encodeURIComponent(body)}`;
      parts.push(
        `<div class="row" data-id="${customer.customerid}">`,
        `<input type="checkbox">`,
        `<a class="who" href="${esc(href)}" target="_blank" rel="noopener">${esc(name || phone)}</a>`,
        `<span class="meta">${esc(phone)}</span>`,
        `</div>`,
        `<details><summary>preview</summary><pre>${esc(body)}</pre></details>`
      );
    }
  });

  parts.push(
    `<script>
      // Keyed by campaign invite link, not by file path or contact count --
      // regenerating the export (after fixing a phone number, or excluding
      // people already in the Community) must not wipe the record of who has
      // already been messaged. A genuinely new campaign uses a new link and so
      // starts clean. LEGACY is the older path+count key, read once so ticks
      // made before this change survive.
      const KEY = ${JSON.stringify("bc-outreach:" + link)};
      const LEGACY = ${JSON.stringify("bc-outreach:" + file + ":" + (messages.size || 0))};
      // sent.csv wins as the durable record; localStorage is a convenience
      // layer on top. Union of both, so neither source loses a tick.
      const FROM_CSV = ${JSON.stringify(alreadySent || [])};
      const done = new Set([
        ...JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY) || "[]"),
        ...FROM_CSV,
      ]);
      const rows = [...document.querySelectorAll(".row")];
      function save(){ localStorage.setItem(KEY, JSON.stringify([...done])); render(); }
      function render(){
        document.getElementById("count").textContent = done.size + " / " + rows.length;
      }
      // localStorage is per-browser and easy to lose. This puts the record
      // somewhere durable -- paste it into tasks/todo.md or the database.
      function copySent(){
        const ids = rows.filter(r => done.has(r.dataset.id)).map(r => r.dataset.id);
        navigator.clipboard.writeText(ids.join(","));
        alert(ids.length + " customer ids copied to clipboard.");
      }
      // Downloads to the browser's download folder; move it next to the
      // export as sent.csv and the generator will pick it up on the next run.
      function saveCsv(){
        const sent = rows.filter(r => done.has(r.dataset.id));
        const stamp = new Date().toISOString();
        const lines = ["customerid,name,phone,sent_at"];
        for (const r of sent) {
          const name = r.querySelector(".who").textContent.replace(/"/g, '""');
          const phone = r.querySelector(".meta").textContent.trim();
          lines.push(r.dataset.id + ',"' + name + '",' + phone + "," + stamp);
        }
        const blob = new Blob([lines.join("\n") + "\n"], {type:"text/csv"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "sent.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      }
      function loadCsv(input){
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const ids = String(reader.result).split(/\r?\n/).slice(1)
            .map(l => l.split(",")[0].replace(/"/g, "").trim())
            .filter(id => /^[0-9]+$/.test(id));
          let added = 0;
          for (const id of ids) if (!done.has(id)) { done.add(id); added++; }
          apply(); save();
          alert("Loaded " + ids.length + " rows (" + added + " newly marked).");
        };
        reader.readAsText(file);
        input.value = "";
      }
      function apply(){
        for (const row of rows) {
          const box = row.querySelector("input");
          box.checked = done.has(row.dataset.id);
          row.classList.toggle("done", box.checked);
        }
      }
      for (const row of rows) {
        const id = row.dataset.id;
        const box = row.querySelector("input");
        box.checked = done.has(id);
        row.classList.toggle("done", box.checked);
        box.addEventListener("change", () => {
          box.checked ? done.add(id) : done.delete(id);
          row.classList.toggle("done", box.checked);
          save();
        });
        // Opening the chat is the act of sending, so tick it automatically --
        // one less thing to remember mid-flow. Untick by hand if it was a miss.
        row.querySelector("a").addEventListener("click", () => {
          if (!box.checked) { box.checked = true; done.add(id); row.classList.add("done"); save(); }
        });
      }
      render();
    </script></body></html>`
  );

  fs.writeFileSync(file, parts.join("\n"), "utf8");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Companion to the vCards: who to message, in the order to message them, and
// what to say. "Last bought" is the personalisation hook -- naming the actual
// purchase re-establishes recall far better than naming the shop.
function writeOutreachList(file, batches, history) {
  const rows = [["batch", "name", "phone", "last_purchase", "visits", "last_bought"]];

  batches.forEach((batch, i) => {
    for (const { customer, phone, lastBill } of batch) {
      const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ").trim();
      const when = lastBill
        ? new Date(lastBill).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
        : "never";
      const past = history.get(customer.customerid);
      const bought = (past?.items ?? []).slice(0, 3).join("; ");
      rows.push([i + 1, name, phone, when, past?.billCount ?? 0, bought]);
    }
  });

  fs.writeFileSync(file, rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n", "utf8");
}

// Batches are ordered newest-first, so a batch is summarised by how long ago
// its oldest member last bought -- that is the number that governs add risk.
function describeRecency(batch) {
  const never = batch.filter((entry) => !entry.lastBill).length;
  if (never === batch.length) return "never billed";

  const oldest = Math.min(...batch.filter((e) => e.lastBill).map((e) => e.lastBill));
  const months = (Date.now() - oldest) / (1000 * 60 * 60 * 24 * 30.44);
  const age = months < 1 ? "within 1 month" : `within ${Math.ceil(months)} months`;

  return never ? `${age}, ${never} never billed` : age;
}

function reportInvalid(invalid) {
  console.log(`\n${invalid.length} customer(s) skipped -- unusable phone number:`);
  for (const { customer, reason } of invalid) {
    const name = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
    console.log(`  customerid ${customer.customerid}  ${name}  (${reason})`);
  }
  console.log("Fix these in the Customers page, then re-run.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
