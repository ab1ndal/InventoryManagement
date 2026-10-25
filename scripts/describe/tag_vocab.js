// Owner-approved tag vocabulary (tag_vocab.json, approved 2026-10-25) as lookups for the prompt and checks.
const V = require("./tag_vocab.json");

const SINGLE = ["silhouette", "length", "neck", "sleeve"];

const familyOf = categoryid =>
  Object.keys(V.families).find(f => V.families[f].categories.includes(categoryid)) || null;

// Values of one group allowed for one family; empty when the group does not apply to it.
const allowed = (group, family) => {
  const g = V.groups[group];
  if (!family || !g.families.includes(family)) return [];
  return g.values.filter(v => (v.families || g.families).includes(family)).map(v => v.value);
};

// Values in a model output that the family may not use: [{group, value}].
const violations = (out, family) => {
  const bad = [];
  const check = (group, value) => { if (value && !allowed(group, family).includes(value)) bad.push({ group, value }); };
  (out.occasion || []).forEach(v => check("occasion", v));
  (out.work || []).forEach(w => check("work", w.type));
  (out.print_weave || []).forEach(v => check("print_weave", v));
  SINGLE.forEach(k => check(k, out[k]));
  return bad;
};

// The TAGS block of prompt.md for one family.
const promptBlock = family => {
  const line = (group, how) => {
    const vals = allowed(group, family);
    return vals.length ? `- ${group}: ${how} from [${vals.join(", ")}]` : `- ${group}: always empty for this product`;
  };
  return [
    "TAGS: use only the values listed below, spelled exactly. A value not in the list is not allowed; leave it out instead.",
    line("occasion", "every occasion the piece clearly suits (no fixed limit), only"),
    line("work", `"type" is the technique only, one per item,`),
    line("print_weave", "every print or weave that applies,"),
    ...SINGLE.map(k => line(k, `one value, or "" if not visible or unclear,`)),
    `Work: put where it sits in "placement" (free text, it is not a tag); each work item carries confidence 0–1. Use "festive" when the piece suits festivals (there is no separate festival tag). If a print or weave was named as work, list it under print_weave instead.`
  ].join("\n");
};

module.exports = { familyOf, allowed, violations, promptBlock, SINGLE };
