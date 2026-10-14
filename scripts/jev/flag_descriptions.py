"""Flag product descriptions that need editing, using TypeSafe Jev.

Usage: /opt/homebrew/opt/python@3.10/bin/python3.10 -I scripts/jev/flag_descriptions.py . <out_csv> [limit]
(python.org Python 3.11 here lacks CA certs; output CSV contains raw descriptions,
including supplier names, so write it outside the repo.)

Three checks per description, in order:
  1. safe       - no confidential/internal info (cost, MRP, supplier, phone...).
                  Checked locally against the product's own purchaseprice AND by Jev.
  2. meaningful - reads as a real description for a shopper.
  3. adds_info  - contains something not already shown elsewhere
                  (name, category, fabric, colours, sizes, price).
Reads all products via the service-role REST API. Only public catalogue
fields are sent to Jev; purchaseprice is used locally and never sent.
Read-only: nothing is written to the database.
"""
import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

JEV_URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
WORKERS = 4
MAX_ATTEMPTS = 5
THRESHOLD = 0.5

QUESTIONS = {
    "unsafe": {
        "type": "noul",
        "instructions": (
            "The description contains confidential or internal business information that should not be "
            "shown to shoppers: a purchase price, cost, MRP, margin, rate, supplier or vendor name, "
            "internal stock notes or codes, phone numbers, or customer details."
        ),
    },
    "meaningful": {
        "type": "noul",
        "instructions": (
            "The description reads as a meaningful product description for a shopper: clear wording that "
            "describes the garment, not shorthand notes, a bare list of colours/sizes/numbers, or a caption "
            "describing a photo (e.g. 'this image shows')."
        ),
    },
    "adds_info": {
        "type": "noul",
        "instructions": (
            "The description contains information about the product that is NOT already shown in the other "
            "fields (name, category, fabric, colours, sizes, retail price), such as embroidery or work, style, "
            "occasion, fit, length, or what pieces are included."
        ),
    },
}

LOCAL_UNSAFE = re.compile(r"\bpur\b|purchase|\bmrp\b|\bcost\b|\bmargin\b|\b\d{10}\b", re.I)


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
    select = ("productid,name,description,fabric,retailprice,purchaseprice,"
              "categories(name),productsizecolors(color,size),productimages(imageid)")
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


def local_unsafe(p, desc):
    """Deterministic check that never leaves this machine."""
    if LOCAL_UNSAFE.search(desc):
        return True
    cost = p.get("purchaseprice")
    if cost and float(cost) >= 100:
        return re.search(rf"(?<!\d){int(float(cost))}(?!\d)", desc) is not None
    return False


def state_for(p):
    # Public fields only. Never add purchaseprice here.
    variants = p.get("productsizecolors") or []
    return {
        "name": p["name"],
        "category": (p.get("categories") or {}).get("name"),
        "fabric": p.get("fabric"),
        "retail_price": p.get("retailprice"),
        "colours": sorted({v["color"] for v in variants if v.get("color")}),
        "sizes": sorted({v["size"] for v in variants if v.get("size")}),
        "description": p["description"],
    }


def ask_jev(api_key, state):
    body = json.dumps({"state": state, "model": MODEL, "questions": QUESTIONS}).encode()
    for attempt in range(MAX_ATTEMPTS):
        req = urllib.request.Request(
            JEV_URL, data=body, method="POST",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 529) and attempt < MAX_ATTEMPTS - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError(f"Jev HTTP {e.code}: {e.read().decode()[:300]}") from e
    raise RuntimeError("Jev retries exhausted")


def decide(local_hit, unsafe, meaningful, adds_info):
    if local_hit or unsafe >= THRESHOLD:
        return "fix-unsafe"
    if adds_info < THRESHOLD:
        return "clear-nothing-new"
    if meaningful < THRESHOLD:
        return "rewrite"
    return "keep"


def evaluate(api_key, p):
    desc = (p.get("description") or "").strip()
    row = {"productid": p["productid"], "name": p["name"], "visible": bool(p.get("productimages")),
           "action": "", "local_unsafe": "", "unsafe": "", "meaningful": "", "adds_info": "",
           "description": desc, "error": ""}
    if not desc:
        return {**row, "action": "empty"}
    hit = local_unsafe(p, desc)
    try:
        a = ask_jev(api_key, state_for(p))["answers"]
    except Exception as e:  # recorded per row so one failure doesn't lose the run
        return {**row, "action": "fix-unsafe" if hit else "", "local_unsafe": hit, "error": str(e)}
    scores = {k: round(a[k]["noul"], 3) for k in QUESTIONS}
    return {**row, **scores, "local_unsafe": hit, "action": decide(hit, **scores)}


def main():
    repo_dir, out_csv = sys.argv[1], sys.argv[2]
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
    env = load_env(repo_dir)
    products = fetch_products(env)
    if limit:
        products = products[:limit]
    print(f"products: {len(products)}", file=sys.stderr)
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda p: evaluate(env["TYPESAFE_KEY"], p), products))
    fields = ["productid", "name", "visible", "action", "local_unsafe", "unsafe", "meaningful",
              "adds_info", "description", "error"]
    with open(out_csv, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        w.writerows(results)
    errors = sum(1 for r in results if r["error"])
    print(f"wrote {out_csv} ({len(results)} rows, {errors} errors)", file=sys.stderr)


if __name__ == "__main__":
    main()
