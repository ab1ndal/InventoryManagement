// List products whose first pass needs a second opinion: node flag_hard.js <ids.txt> <work_dir>
// Hard = any "uncertain" or "conflicts" entry, a work tag with confidence below 0.7, or a tag value
// the product's category family may not use (tag_vocab.json).
const fs = require("fs"), path = require("path");
const { familyOf, violations } = require("./tag_vocab");
const [ids, W] = process.argv.slice(2);
const products = JSON.parse(fs.readFileSync(path.join(W, "products.json"), "utf8"));
for (const id of fs.readFileSync(ids, "utf8").trim().split("\n")) {
  const o = JSON.parse(fs.readFileSync(path.join(W, id, "out_codex.json"), "utf8"));
  const family = familyOf(products.find(p => p.productid === id)?.categoryid);
  if (o.uncertain.length || o.conflicts.length || o.work.some(w => w.confidence < 0.7) || violations(o, family).length) console.log(id);
}
