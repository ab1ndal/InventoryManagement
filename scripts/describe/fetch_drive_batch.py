"""Fetch up to N original Drive photos per product.
Usage: fetch_drive_batch.py <urls.tsv: productid<TAB>folder_url> <out_root> [max_per_product]
Picks loose images first, then the first image of each variant subfolder, skipping reserved
subfolders (published/rejected/edit/skipped). Writes <out_root>/<id>/orig_<n>.<ext> and a
manifest line per product to stdout: id, status, picked/total."""
import sys, pathlib, concurrent.futures as cf
from mockup_generator.integrations import drive_client as dc

tsv, root = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
cap = int(sys.argv[3]) if len(sys.argv) > 3 else 3

def one(line):
    pid, url = line.split("\t")
    fid = dc.extract_folder_id(url)
    if not fid:
        return f"{pid}\tno-folder\t0/0"
    try:
        g = dc.list_folder_image_groups(fid)
    except Exception as exc:
        return f"{pid}\terror:{type(exc).__name__}:{exc}"[:200]
    groups = [x for x in g["groups"] if x["name"] not in dc._RESERVED_SUBFOLDERS]
    picks = list(g["loose"][:cap])
    for grp in groups:
        if len(picks) >= cap:
            break
        picks.append(grp["images"][0])
    total = len(g["loose"]) + sum(len(x["images"]) for x in groups)
    out = root / pid
    out.mkdir(parents=True, exist_ok=True)
    for n, img in enumerate(picks, 1):
        ext = pathlib.Path(img["name"]).suffix.lower() or ".jpg"
        (out / f"orig_{n}{ext}").write_bytes(dc.download_file(img["id"]))
    return f"{pid}\tok\t{len(picks)}/{total}"

lines = [l for l in tsv.read_text().splitlines() if l.strip()]
with cf.ThreadPoolExecutor(4) as ex:
    for r in ex.map(one, lines):
        print(r, flush=True)
