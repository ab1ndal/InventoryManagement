// Fill prompt.md with one product's public catalogue data: node build_prompt.js <products.json> <id> <prompt.md>
const fs = require("fs");
const [products, id, tpl] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(products, "utf8")).find(x => x.productid === id);
if (!p) throw new Error(`product ${id} not in ${products}`);
const uniq = k => [...new Set((p.productsizecolors || []).map(v => v[k]))].join(", ");
const data = `name: ${p.name}\ncategory: ${p.categories?.name}\nfabric: ${p.fabric}\ncolours: ${uniq("color")}\nsizes: ${uniq("size")}`;
// Optional owner review note for this product, saved as <work_dir>/<id>/owner_note.txt by the review loop.
const notePath = require("path").join(require("path").dirname(products), id, "owner_note.txt");
const ownerNote = fs.existsSync(notePath)
  ? `\nOWNER REVIEW NOTE on the previous draft (follow it):\n${fs.readFileSync(notePath, "utf8").trim()}\n`
  : "";
// Long or markdown-styled descriptions are earlier AI photo captions (owner: often wrong); short ones are the shop's own.
const text = p.description || "";
const aiWritten = text.includes("**") || text.length > 200;
const source = aiWritten
  ? "written earlier by an AI from photos; it may be wrong, so trust the photos over it"
  : "written by the shop; facts here are true unless a photo clearly contradicts them";
process.stdout.write(fs.readFileSync(tpl, "utf8").replace("{DATA}", data).replace("{TEXT_SOURCE}", source).replace("{TEXT}", text || "(none)").replace("{OWNER_NOTE}", ownerNote));
