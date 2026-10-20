// Build a before/after review page.
// usage: node build_review.js <work_dir> <ids.txt> <hard.txt> <out.html> [heading] [summary.html]
const fs = require("fs"), path = require("path");
const [run, idsFile, hardFile, outFile, heading = "Description review", summaryFile] = process.argv.slice(2);
const products = JSON.parse(fs.readFileSync(path.join(run, "products.json"), "utf8"));
const ids = fs.readFileSync(idsFile, "utf8").trim().split("\n");
const hard = new Set(fs.readFileSync(hardFile, "utf8").trim().split("\n"));
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));
const uri = f => "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");
const chips = (label, vals) => {
  vals = (Array.isArray(vals) ? vals : [vals]).filter(Boolean);
  return vals.length ? `<div class="tagrow"><span class="tk">${label}</span>${vals.map(v => `<span class="chip">${esc(v)}</span>`).join("")}</div>` : "";
};

const cards = ids.map((id, i) => {
  const p = products.find(x => x.productid === id);
  const terra = read(path.join(run, id, "out_codex.json"));
  const isHard = hard.has(id);
  const fin = isHard ? read(path.join(run, id, "out_claude.json")) : terra;
  const colours = [...new Set(p.productsizecolors.map(v => v.color))].join(", ");
  const sizes = [...new Set(p.productsizecolors.map(v => v.size))].join(", ");
  const thumbs = fs.readdirSync(path.join(run, id, "thumb")).sort((a, b) => (a.startsWith("mockup") ? 1 : 0) - (b.startsWith("mockup") ? 1 : 0) || a.localeCompare(b));
  const imgs = thumbs.map(t => `<figure><img loading="lazy" src="${uri(path.join(run, id, "thumb", t))}" alt="${esc(id + " " + t)}"><figcaption class="${t.startsWith("mockup") ? "mk" : ""}">${t.startsWith("mockup") ? "AI mockup" : "Original " + t.match(/\d+/)[0]}</figcaption></figure>`).join("");
  const work = fin.work.map(w => `${w.type}${w.placement ? " (" + w.placement + ")" : ""}${w.confidence < 0.7 ? " ?" : ""}`);
  const flags = [...fin.uncertain.map(u => ["Unsure", u]), ...fin.conflicts.map(c => ["Conflict", c])];
  return `<article class="card" id="${id}">
  <header class="ch"><div><h2>${esc(p.name)}</h2><p class="meta"><span class="mono">${id}</span> · ${esc(p.categories?.name)} · ${esc(p.fabric)} · ${esc(colours)} · ${esc(sizes)}</p></div>
  <span class="badge ${isHard ? "b-hard" : "b-ok"}">${isHard ? "Second opinion: Claude Sonnet" : "Codex"}</span></header>
  <div class="imgs">${imgs}</div>
  <div class="cmp">
    <section class="old"><h3>Live now</h3><p>${esc(p.description || "(empty)")}</p></section>
    <section class="new"><h3>Proposed</h3><p>${esc(fin.description)}</p></section>
  </div>
  <div class="tags">${chips("Work", work)}${chips("Print / weave", fin.print_weave)}${chips("Cut", [fin.silhouette, fin.length, fin.neck, fin.sleeve])}${chips("Occasion", fin.occasion)}${chips("Festival", fin.festival)}</div>
  ${flags.length ? `<ul class="flags">${flags.map(([k, v]) => `<li><b class="${k === "Conflict" ? "fc" : "fu"}">${k}</b> ${esc(v)}</li>`).join("")}</ul>` : ""}
  ${isHard ? `<details><summary>Codex first pass</summary><p>${esc(terra.description)}</p></details>` : ""}
  <form class="fb" data-id="${id}" data-proposed="${esc(fin.description)}">
    <fieldset class="verdicts"><legend>Your verdict</legend>
      <label><input type="radio" name="v-${id}" id="v-${id}-approve" value="approve"> Approve</label>
      <label><input type="radio" name="v-${id}" id="v-${id}-change" value="change"> Needs changes</label>
      <label><input type="radio" name="v-${id}" id="v-${id}-reject" value="reject"> Reject</label>
    </fieldset>
    <label class="cl" for="c-${id}">Comments for the rewrite</label>
    <textarea id="c-${id}" rows="3" placeholder="What's wrong or missing? E.g. the blouse is semi-stitched; mention the gota border."></textarea>
    <div class="fbrow"><button type="submit">Save</button><span class="st" aria-live="polite"></span></div>
  </form>
</article>`;
}).join("\n");

const html = fs.readFileSync(path.join(__dirname, "review_shell.html"), "utf8")
  .replace("{{HEADING}}", esc(heading)).replace("{{SUMMARY}}", summaryFile ? fs.readFileSync(summaryFile, "utf8") : "").replace("{{COUNT}}", ids.length).replace("{{HARD}}", hard.size).replace("{{CARDS}}", cards);
fs.writeFileSync(outFile, html);
console.log("wrote", outFile, (html.length / 1e6).toFixed(2), "MB");
