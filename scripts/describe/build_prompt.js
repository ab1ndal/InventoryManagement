// Fill prompt.md with one product's public catalogue data: node build_prompt.js <products.json> <id> <prompt.md>
const fs = require("fs");
const [products, id, tpl] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(products, "utf8")).find(x => x.productid === id);
if (!p) throw new Error(`product ${id} not in ${products}`);
const uniq = k => [...new Set((p.productsizecolors || []).map(v => v[k]))].join(", ");
const data = `name: ${p.name}\ncategory: ${p.categories?.name}\nfabric: ${p.fabric}\ncolours: ${uniq("color")}\nsizes: ${uniq("size")}`;
process.stdout.write(fs.readFileSync(tpl, "utf8").replace("{DATA}", data).replace("{TEXT}", p.description || "(none)"));
