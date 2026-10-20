// List products whose first pass needs a second opinion: node flag_hard.js <ids.txt> <work_dir>
// Hard = any "uncertain" or "conflicts" entry, or a work tag with confidence below 0.7.
const fs = require("fs"), path = require("path");
const [ids, W] = process.argv.slice(2);
for (const id of fs.readFileSync(ids, "utf8").trim().split("\n")) {
  const o = JSON.parse(fs.readFileSync(path.join(W, id, "out_codex.json"), "utf8"));
  if (o.uncertain.length || o.conflicts.length || o.work.some(w => w.confidence < 0.7)) console.log(id);
}
