"""Shortlist Diwali products with TypeSafe Jev.

Usage: /opt/homebrew/opt/python@3.10/bin/python3.10 -I scripts/jev/diwali_shortlist.py . <out_dir>

Scores every storefront-visible, in-stock product for festive (Diwali) suitability
and writes:
  <out_dir>/diwali_candidates.csv  - all scored products, best first
  <out_dir>/diwali_pick.json       - top candidates (with first image) for the pick sheet
  <out_dir>/diwali_auto50.json     - provisional 50, balanced across categories
Only public catalogue fields are sent to Jev (never purchaseprice). Read-only.
"""
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

JEV_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
WORKERS = 4
MAX_ATTEMPTS = 5
PICK_COUNT = 120
AUTO_COUNT = 50
# No single category may take more than this share of the provisional 50.
MAX_PER_CATEGORY = 10
# Core categories named in the 2026-10-13 design meeting get a guaranteed share,
# so the festive ranking (which favours lehengas/sherwanis) doesn't crowd out
# affordable everyday-festive buys.
MIN_PER_CATEGORY = {"Saree": 8, "Kurti": 6, "Kurta Pajama": 5, "Suits": 4, "Lehenga": 6}

QUESTIONS = {
    "festive": {
        "type": "noul",
        "instructions": (
            "This garment would be a good choice to wear for Diwali or other Indian festivals: "
            "festive, celebratory, rich colours, zari/embroidery/sequins or silk-like fabrics, "
            "rather than plain daily, office or casual wear."
        ),
    },
    "wedding": {
        "type": "noul",
        "instructions": "This garment suits a wedding or wedding function (sangeet, mehendi, reception).",
    },
    "casual": {
        "type": "noul",
        "instructions": "This garment is mainly plain daily, casual, office or loungewear.",
    },
}


def load_env(repo_dir):
    env = {}
    with open(f"{repo_dir}/.env") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k] = v.strip().strip('"').strip("'")
    return env


def fetch_products(env):
    base = env["REACT_APP_SUPABASE_URL"] + "/rest/v1/products"
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    select = ("productid,name,description,fabric,retailprice,categories(name),"
              "productsizecolors(color,size,stock),productimages!inner(imageurl,displayorder)")
    rows, offset, page = [], 0, 1000
    while True:
        q = urllib.parse.urlencode({"select": select, "order": "productid"})
        req = urllib.request.Request(
            f"{base}?{q}",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{offset}-{offset + page - 1}"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.load(r)
        rows.extend(batch)
        if len(batch) < page:
            return rows
        offset += page


def ask_jev(api_key, state):
    body = json.dumps({"state": state, "model": MODEL, "questions": QUESTIONS}).encode()
    for attempt in range(MAX_ATTEMPTS):
        req = urllib.request.Request(
            JEV_URL, data=body, method="POST",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)["answers"]
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Jev HTTP {e.code}: {e.read().decode()[:300]}") from e
    raise RuntimeError("Jev retries exhausted")


def summarise(p):
    variants = p.get("productsizecolors") or []
    images = sorted(p["productimages"], key=lambda i: (i.get("displayorder") or 0))
    return {
        "productid": p["productid"],
        "name": p["name"],
        "category": (p.get("categories") or {}).get("name") or "",
        "fabric": p.get("fabric") or "",
        "price": p.get("retailprice"),
        "stock": sum(int(v.get("stock") or 0) for v in variants),
        "colours": sorted({v["color"] for v in variants if v.get("color")}),
        "sizes": sorted({v["size"] for v in variants if v.get("size")}),
        "image": images[0]["imageurl"],
        "image_count": len(images),
        "description": (p.get("description") or "").strip(),
    }


def score(api_key, s):
    state = {k: s[k] for k in ("name", "category", "fabric", "colours", "description")}
    try:
        a = ask_jev(api_key, state)
        return {**s, **{k: round(a[k]["noul"], 3) for k in QUESTIONS}, "error": ""}
    except Exception as e:  # recorded per row; a failed row just ranks last
        return {**s, "festive": 0, "wedding": 0, "casual": 1, "error": str(e)}


def rank_key(r):
    # Festive suitability first; nudge up wedding-worthy pieces and multi-angle photos,
    # nudge down casual wear.
    return r["festive"] + 0.3 * r["wedding"] - 0.3 * r["casual"] + 0.02 * min(r["image_count"], 4)


def balanced(rows, count, cap, minimums=None):
    picked, per_cat = [], defaultdict(int)
    for cat, n in (minimums or {}).items():
        for r in [r for r in rows if r["category"] == cat][:n]:
            picked.append(r)
            per_cat[cat] += 1
    chosen = {r["productid"] for r in picked}
    for r in rows:
        if len(picked) >= count:
            break
        if r["productid"] in chosen:
            continue
        if per_cat[r["category"]] < cap:
            picked.append(r)
            per_cat[r["category"]] += 1
    picked.sort(key=rank_key, reverse=True)
    return picked


def main():
    repo_dir, out_dir = sys.argv[1], sys.argv[2]
    env = load_env(repo_dir)
    products = [summarise(p) for p in fetch_products(env)]
    in_stock = [s for s in products if s["stock"] > 0]
    print(f"visible: {len(products)}, in stock: {len(in_stock)}", file=sys.stderr)
    with ThreadPoolExecutor(WORKERS) as pool:
        scored = list(pool.map(lambda s: score(env["TYPESAFE_KEY"], s), in_stock))
    scored.sort(key=rank_key, reverse=True)

    fields = ["productid", "name", "category", "fabric", "price", "stock", "image_count",
              "festive", "wedding", "casual", "description", "error"]
    with open(f"{out_dir}/diwali_candidates.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(scored)
    pick = balanced(scored, PICK_COUNT, MAX_PER_CATEGORY * 3,
                    {k: v * 2 for k, v in MIN_PER_CATEGORY.items()})
    auto = balanced(scored, AUTO_COUNT, MAX_PER_CATEGORY, MIN_PER_CATEGORY)
    keep = ("productid", "name", "category", "fabric", "price", "stock", "image", "image_count",
            "festive", "wedding", "casual")
    with open(f"{out_dir}/diwali_pick.json", "w") as fh:
        json.dump([{k: r[k] for k in keep} for r in pick], fh, indent=1)
    with open(f"{out_dir}/diwali_auto50.json", "w") as fh:
        json.dump([{k: r[k] for k in keep} for r in auto], fh, indent=1)
    errors = sum(1 for r in scored if r["error"])
    print(f"scored {len(scored)} ({errors} errors); pick {len(pick)}; auto {len(auto)}", file=sys.stderr)


if __name__ == "__main__":
    main()
