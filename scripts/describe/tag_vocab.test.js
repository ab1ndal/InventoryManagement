// node --test scripts/describe/tag_vocab.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("./tag_vocab.json");
const schema = require("./schema.json");
const { familyOf, allowed, violations, promptBlock, SINGLE } = require("./tag_vocab");

test("every category sits in at most one family", () => {
  const all = Object.values(V.families).flatMap(f => f.categories);
  assert.equal(all.length, new Set(all).size);
});

test("schema enums match the vocabulary", () => {
  const vals = g => V.groups[g].values.map(v => v.value);
  const p = schema.properties;
  assert.deepEqual(p.occasion.items.enum, vals("occasion"));
  assert.deepEqual(p.print_weave.items.enum, vals("print_weave"));
  assert.deepEqual(p.work.items.properties.type.enum, vals("work"));
  SINGLE.forEach(k => assert.deepEqual(p[k].enum, ["", ...vals(k)]));
});

test("schema has no maxItems (Claude structured outputs reject it)", () => {
  assert.ok(!JSON.stringify(schema).includes("maxItems"));
});

test("flat fabric families get no cut tags", () => {
  for (const fam of ["saree", "dress_material"]) SINGLE.forEach(k => assert.deepEqual(allowed(k, fam), []));
  assert.match(promptBlock("saree"), /- neck: always empty/);
});

test("family-specific values are enforced", () => {
  assert.equal(familyOf("LE"), "lehenga");
  assert.equal(familyOf("NOPE"), null);
  assert.deepEqual(violations({ occasion: ["office", "wedding"], work: [], print_weave: [] }, "lehenga"),
    [{ group: "occasion", value: "office" }]);
  assert.deepEqual(violations({ occasion: ["wedding"], work: [{ type: "zari" }], print_weave: ["brocade"], neck: "" }, "lehenga"), []);
  assert.deepEqual(violations({ occasion: [], work: [], print_weave: [], neck: "round" }, "saree"),
    [{ group: "neck", value: "round" }]);
});

test("occasion has no cap", () => {
  assert.doesNotMatch(promptBlock("women_ready"), /up to 3/);
  assert.equal(V.groups.occasion.max, undefined);
});
