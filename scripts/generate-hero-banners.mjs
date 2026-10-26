// Generate Andaaz-style hero banners via Azure OpenAI images/edits, using
// real product photos as garment references.
// Usage: node banners.mjs <outDir> <baseDir> [slideId[:variant] ...]
import fs from "node:fs";
import path from "node:path";

const { AZURE_URL, AZURE_KEY, OPENAI_MODEL } = process.env;
if (!AZURE_URL || !AZURE_KEY || !OPENAI_MODEL) throw new Error("AZURE_URL/AZURE_KEY/OPENAI_MODEL missing");
const ENDPOINT = `${new URL(AZURE_URL).origin}/openai/v1/images/edits`;

const [outDir, baseDir, ...only] = process.argv.slice(2);

const STYLE = `
Photorealistic luxury Indian ethnicwear campaign photograph for an e-commerce homepage hero banner,
in the style of premium Indian fashion e-commerce editorial shoots: real, natural-looking professional
Indian models, full-length or three-quarter, elegant relaxed poses, gentle confident expressions,
shot on a full-frame camera with an 85mm lens at f/2.8, soft directional natural light, warm refined
colour grade, rich but not oversaturated, shallow depth of field so the background melts into soft bokeh
while garments stay razor sharp. Elegant fine jewellery (kundan/polki earrings, bangles, maang tikka
where fitting), neat styled hair, natural makeup.

GARMENT FIDELITY (most important): each model wears EXACTLY the garment shown in the matching reference
image - same colours, same fabric and sheen, same embroidery and zari motifs, same border widths and
placement, same blouse/neckline, same dupatta or pallu. Do not redesign, recolour or simplify the
garments. Garments must be fully visible from shoulders to hem where the framing allows.

The reference images are flat studio catalogue photos: use them ONLY for the garments. Do NOT copy
their plain grey/beige studio backdrop, lighting or exact pose.`;

const DESKTOP_LAYOUT = `
COMPOSITION (wide 2.6:1 banner): place the models in the RIGHT 55% of the frame. Keep the LEFT 40% of the
frame calm, uncluttered and slightly darker in tone - soft out-of-focus architecture or foliage only,
no people, no bright highlights, no busy detail - because a white headline and button will be overlaid
there. Models' heads well below the top edge, feet near the bottom edge. Eye level camera.`;

const MOBILE_LAYOUT = `
COMPOSITION (portrait 4:5 mobile banner): one model, centred, full-length, occupying the upper 75% of
the frame, head close to the top with a small margin. The bottom 25% is a calm, darker, uncluttered floor
or background area with no detail, because a white headline and button will be overlaid there.`;

const NEGATIVE = `
Absolutely no text, letters, words, logos, watermarks, signatures, price tags, frames or borders anywhere
in the image. No extra fingers, no distorted hands or faces, no plastic skin, no CGI look.`;

const SLIDES = {
  diwali: {
    refs: ["BC252742", "BC25743"],
    scene: `SETTING: the inner courtyard of an old Rajasthani haveli at golden dusk during Diwali. Carved
sandstone arches and pillars, strings of orange and yellow marigold garlands hanging from the arches,
dozens of lit clay diyas lining the steps and floor, scattered rose and marigold petals on the stone floor,
warm fairy-light bokeh. Two women: one wears the green lehenga (reference 1), the other wears the red saree
(reference 2). One holds a brass diya thali.`,
    mobileScene: `SETTING: haveli courtyard at golden dusk during Diwali, marigold garlands, lit clay diyas on
the steps, warm bokeh. The woman wears the green lehenga from reference 1 and holds a brass diya thali.`,
  },
  sarees: {
    refs: ["BC252090", "BC252089"],
    scene: `SETTING: a heritage palace corridor with carved pink-sandstone jharokha arches and jaali screens,
late-morning sunlight streaming through the arches creating soft patterned light on a polished floor.
Two women: one wears the teal saree (reference 1), the other the red saree (reference 2); one is gently
lifting her pallu so its border is displayed, the other walks towards camera.`,
    mobileScene: `SETTING: heritage palace corridor with carved sandstone jharokha arches, soft sunlight.
The woman wears the teal saree from reference 1, pallu gently displayed.`,
  },
  lehengas: {
    refs: ["BC252736", "BC252745"],
    scene: `SETTING: a Mughal-style palace garden terrace in soft afternoon light: white marble pavilion with
cusped arches, a reflecting fountain, potted pink bougainvillea and rose bushes, pastel tones.
Two women: one wears the teal lehenga (reference 1), the other the red lehenga (reference 2). One is
mid-twirl so the lehenga flares, the other stands with her dupatta draped over one arm.`,
    mobileScene: `SETTING: Mughal-style palace garden terrace, white marble arches, fountain, bougainvillea,
soft afternoon light. The woman wears the red lehenga from reference 2, mid-twirl so the skirt flares.`,
    mobileRefs: ["BC252745"],
  },
  "mens-festive": {
    refs: ["BC251259", "BC25810"],
    scene: `SETTING: a royal Rajasthani courtyard with maroon and ochre lime-plastered walls, carved stone
pillars, strings of marigold and jasmine garlands, a brass urli with floating flowers and candles,
rose petals on the stone floor, warm evening light. Two Indian men, well-groomed beards: one wears the
cream-gold sherwani with safa turban (reference 1), the other the pista-green kurta pajama
(reference 2). Relaxed confident stances, one adjusting his cuff.`,
    mobileScene: `SETTING: royal Rajasthani courtyard, maroon walls, marigold garlands, candles, warm evening
light. The man wears the cream-gold sherwani with safa from reference 1.`,
  },
  "plus-size": {
    refs: ["BC252465", "BC252516"],
    scene: `SETTING: the warm, sunlit drawing room of an elegant heritage Indian home: carved wooden jharokha
window with sheer curtains, brass lamps, a low carved wooden settee with silk cushions, fresh tuberose and
rose arrangements, soft golden window light. Two beautiful, curvy plus-size Indian women (Indian size
3XL-4XL, natural full figures, real proportions, NOT slimmed, NOT exaggerated), radiant and confident,
smiling, one laughing naturally. One wears the magenta suit with dupatta (reference 1), the other the
red embroidered suit (reference 2). The garments fit their bodies beautifully and drape naturally.`,
    mobileScene: `SETTING: warm sunlit drawing room of a heritage Indian home, carved wooden window, brass
lamps, flowers. One beautiful curvy plus-size Indian woman (size 3XL-4XL, natural full figure, NOT slimmed),
radiant, confident, smiling, wearing the magenta suit with dupatta from reference 1.`,
    mobileRefs: ["BC252465"],
  },
};

// Owner 2026-10-25: customization (made-to-order tailoring) is a key
// differentiator, so it gets the second slide. A still life, no people: a
// first version with a customer wearing the same lehenga as the dress form
// read as AI-made and made no sense. No product refs, so it uses the
// generations endpoint with its own style block.
SLIDES.customize = {
  stillLife: true,
  scene: `SETTING: a designer's tailoring worktable in a warm Indian boutique workroom, late-afternoon window
light. On a dress form, an unfinished deep-maroon silk blouse with tailor's pins, white chalk lines and
basting stitches. On the table: a pencil-and-watercolour design sketch of a lehenga on cream paper, a fan
of fabric swatches (silk, brocade, velvet, zari-bordered) in jewel tones, a yellow cloth measuring tape
curling across the table, heavy brass tailoring scissors, spools of gold zari thread and a pin cushion.`,
  mobileScene: `SETTING: close view of a designer's tailoring worktable in warm window light: a pencil-and-
watercolour lehenga design sketch on cream paper, a fan of jewel-toned silk and brocade swatches, a yellow
measuring tape, brass scissors and spools of gold zari thread; an unfinished maroon blouse with pins on a
dress form behind.`,
};

const STILL_STYLE = `
Photorealistic editorial still-life photograph for a luxury Indian ethnicwear e-commerce homepage banner.
Real objects, real textures, natural imperfections, shot on a full-frame camera with a 50mm lens at f/4,
soft directional window light, warm refined colour grade, gentle shadows, shallow depth of field.
No people, no hands, no faces, no mannequin heads.`;

const VARIANTS = {
  desktop: { size: "2560x976", layout: DESKTOP_LAYOUT, scene: (s) => s.scene, refs: (s) => s.refs },
  mobile: {
    size: "1088x1360",
    layout: MOBILE_LAYOUT,
    scene: (s) => s.mobileScene,
    refs: (s) => s.mobileRefs || s.refs.slice(0, 1),
  },
};

const STILL_LAYOUTS = {
  desktop: `
COMPOSITION (wide 2.6:1 banner): the dress form and worktable fill the RIGHT 55% of the frame. Keep the
LEFT 40% calm, uncluttered and slightly darker - a soft out-of-focus plaster wall or fabric shelves only,
no bright highlights, no busy detail - because a white headline and button will be overlaid there.`,
  mobile: `
COMPOSITION (portrait 4:5 mobile banner): the objects fill the upper 70% of the frame. The bottom 30% is a
calm, darker, uncluttered stretch of wooden table with no objects, because a white headline and button
will be overlaid there.`,
};

function buildPrompt(slide, v) {
  const style = slide.stillLife ? STILL_STYLE : STYLE;
  const layout = slide.stillLife ? STILL_LAYOUTS[v === VARIANTS.mobile ? "mobile" : "desktop"] : v.layout;
  return [style, v.scene(slide), layout, NEGATIVE].map((s) => s.trim()).join("\n\n");
}

async function generate(id, variantName) {
  const slide = SLIDES[id];
  const v = VARIANTS[variantName];
  const prompt = buildPrompt(slide, v);
  const refs = slide.refs ? v.refs(slide) : [];
  if (!refs.length) return saveResult(id, variantName, prompt, await callApi(
    ENDPOINT.replace(/edits$/, "generations"),
    { "Content-Type": "application/json" },
    JSON.stringify({ model: OPENAI_MODEL, prompt, size: v.size, quality: "high", n: 1 }),
    `${id}:${variantName}`
  ));
  const form = new FormData();
  form.append("model", OPENAI_MODEL);
  form.append("prompt", prompt);
  form.append("size", v.size);
  form.append("quality", "high");
  form.append("n", "1");
  for (const pid of refs) {
    const file = path.join(baseDir, `${pid}.webp`);
    form.append("image[]", new Blob([fs.readFileSync(file)], { type: "image/webp" }), `${pid}.webp`);
  }
  saveResult(id, variantName, prompt, await callApi(ENDPOINT, {}, form, `${id}:${variantName}`));
}

async function callApi(url, headers, body, label) {
  const started = Date.now();
  const res = await fetch(url, { method: "POST", headers: { "api-key": AZURE_KEY, ...headers }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  const b64 = JSON.parse(text).data?.[0]?.b64_json;
  if (!b64) throw new Error(`${label} no image in response: ${text.slice(0, 300)}`);
  return { b64, seconds: Math.round((Date.now() - started) / 1000) };
}

function saveResult(id, variantName, prompt, { b64, seconds }) {
  const out = path.join(outDir, `${id}-${variantName}.png`);
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
  fs.writeFileSync(out.replace(/\.png$/, ".prompt.txt"), prompt);
  console.log(`ok ${out} (${seconds}s)`);
}

const jobs = (only.length ? only : Object.keys(SLIDES).flatMap((id) => [`${id}:desktop`, `${id}:mobile`])).map(
  (j) => (j.includes(":") ? j.split(":") : [j, "desktop"])
);
fs.mkdirSync(outDir, { recursive: true });
const results = await Promise.allSettled(jobs.map(([id, v]) => generate(id, v)));
for (const r of results) if (r.status === "rejected") console.error("FAIL", r.reason.message);
process.exitCode = results.some((r) => r.status === "rejected") ? 1 : 0;
