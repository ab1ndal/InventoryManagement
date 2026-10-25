#!/usr/bin/env node
// Renders tag_vocab.json into a review page with one feedback form per tag group.
// Usage: node scripts/describe/build_vocab_review.js <out.html>
// Feedback lands in the page's db at vocab_feedback/<group>: {verdict, comment, updatedAt}.
const fs = require("fs");
const path = require("path");

const out = process.argv[2];
if (!out) { console.error("usage: build_vocab_review.js <out.html>"); process.exit(1); }
const V = JSON.parse(fs.readFileSync(path.join(__dirname, "tag_vocab.json"), "utf8"));
const shell = fs.readFileSync(path.join(__dirname, "review_shell.html"), "utf8");

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const famIds = Object.keys(V.families);
const STATUS_NOTE = { "UNCLEAR": "dropped (too vague)" };

const groupCard = (gid, g) => {
  const fams = famIds.filter(f => g.families.includes(f));
  const head = fams.map(f => `<th>${esc(V.families[f].label)}</th>`).join("");
  const rows = g.values.map(v => {
    const vf = v.families || g.families;
    const cells = fams.map(f => vf.includes(f) ? `<td class="y">✓</td>` : `<td class="n">–</td>`).join("");
    return `<tr><th scope="row">${esc(v.label)}</th>${cells}</tr>`;
  }).join("");
  const notIn = famIds.filter(f => !g.families.includes(f)).map(f => V.families[f].label);
  const rules = [
    g.max ? `Up to ${g.max} per product.` : "",
    g.shop_filter ? "Shown as a shop filter and on the product page." : "Shown on the product page only.",
    notIn.length ? `Not used for ${notIn.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  const aliases = Object.entries(V.aliases[gid] || {}).map(([from, to]) => {
    const target = to.startsWith("MOVE:") ? `moved to ${V.groups[to.slice(5)].label}`
      : STATUS_NOTE[to] || (g.values.find(v => v.value === to) || { label: to }).label;
    return `<li><span class="mono">${esc(from)}</span> → ${esc(target)}</li>`;
  }).join("");
  return `<article class="card">
  <div class="ch"><h2>${esc(g.label)}</h2><p class="meta">${esc(rules)}</p></div>
  <div class="tbl"><table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
  ${aliases ? `<details><summary>How the pilot's own wording maps here</summary><ul class="al">${aliases}</ul></details>` : ""}
  <form class="fb" data-id="${esc(gid)}">
    <fieldset class="verdicts"><legend>Your call</legend>
      <label><input type="radio" name="v-${esc(gid)}" value="approve"> Approve</label>
      <label><input type="radio" name="v-${esc(gid)}" value="change"> Needs changes</label>
    </fieldset>
    <label class="cl" for="c-${esc(gid)}">Comment (values to add, remove or rename)</label>
    <textarea id="c-${esc(gid)}" rows="2"></textarea>
    <div class="fbrow"><button type="submit">Save</button><span class="st"></span></div>
  </form>
</article>`;
};

const famList = famIds.map(f => `<li><b>${esc(V.families[f].label)}</b>: ${V.families[f].categories.map(esc).join(", ")}</li>`).join("");
const summary = `<p>Each product gets tags only from these lists. Tags the AI is unsure of go to a review list instead of the site. Where the work sits (neckline, border, pallu) stays in the description text and is not a tag.</p>
<details><summary>Which categories are in each family</summary><ul class="al">${famList}</ul></details>`;

const css = `
.tbl { overflow-x: auto; }
table { border-collapse: collapse; font-size: 13.5px; min-width: 100%; }
th, td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: center; white-space: nowrap; }
thead th { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
tbody th { text-align: left; font-weight: 500; }
td.y { color: var(--ok); font-weight: 600; } td.n { color: var(--line); }
.al { margin: 8px 0 0; padding-left: 18px; display: grid; gap: 3px; }
`;

let html = shell
  .replace("{{HEADING}}", "Tag vocabulary draft")
  .replace(/<p class="lede">[\s\S]*?<\/p>/, `<p class="lede">The fixed list of tags the description batch may use, per category family. Nothing is in the database yet. Approve each group or say what to change.</p>`)
  .replace(/<div class="eyebrow">[\s\S]*?<\/div>\s*/, "")
  .replace("<h2>What the pilot showed</h2>", "<h2>How tags work</h2>")
  .replace(/<div class="stats">[\s\S]*?<\/div>/, `<div class="stats"><span><b>${Object.keys(V.groups).length}</b> tag groups</span><span><b>${famIds.length}</b> category families</span><span id="progress" class="progress"></span></div>`)
  .replace("{{SUMMARY}}", summary)
  .replace("{{CARDS}}", Object.entries(V.groups).map(([gid, g]) => groupCard(gid, g)).join("\n"))
  .replace("</style>", css + "</style>")
  .replace(/<title>[\s\S]*?<\/title>/, "<title>Tag Vocabulary Draft</title>")
  .replace('db.collection("feedback")', 'db.collection("vocab_feedback")')
  .replace("{verdict, comment, proposed, updatedAt}", "{verdict, comment, updatedAt}")
  .replace(", proposed: form.dataset.proposed", "")
  .replace(/Comments can't be saved/, "Feedback can't be saved")
  .replace(/Saved comments couldn't load/, "Saved feedback couldn't load")
  .replace(/You don't have permission to save comments here\./, "You don't have permission to save feedback here.");

if (html.includes("{{")) { console.error("unfilled placeholder"); process.exit(1); }
fs.writeFileSync(out, html);
console.log("wrote", out);
