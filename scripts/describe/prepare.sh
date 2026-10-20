#!/bin/zsh
# Prepare a working set for a list of product IDs.
# usage: scripts/describe/prepare.sh <ids.txt> [work_dir=.describe-work]
# Fetches public product data (anon key, so no purchase price), up to 3 Drive originals per product
# (via mockup-generator's Drive service account), one AI mockup, and 420px review thumbnails.
set -euo pipefail
here=${0:A:h}; repo=${here:h:h}; ids=${1:A}; W=${2:-$repo/.describe-work}; W=${W:A}
MG=${MOCKUP_GENERATOR_DIR:-$repo/../mockup-generator}
mkdir -p $W
source $repo/.env
idlist=$(paste -sd, $ids)
# Public fields only: never send purchaseprice to a model.
curl -sf -H "apikey: $REACT_APP_SUPABASE_ANON_KEY" -H "Authorization: Bearer $REACT_APP_SUPABASE_ANON_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/products?select=productid,name,fabric,description,categories(name),productsizecolors(color,size)&productid=in.($idlist)" > $W/products.json
curl -sf -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/products?select=productid,producturl&productid=in.($idlist)" \
  | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).forEach(r=>console.log(r.productid+"\t"+(r.producturl||"")))' > $W/urls.tsv
curl -sf -H "apikey: $REACT_APP_SUPABASE_ANON_KEY" -H "Authorization: Bearer $REACT_APP_SUPABASE_ANON_KEY" \
  "$REACT_APP_SUPABASE_URL/rest/v1/productimages?select=productid,imageurl,displayorder&productid=in.($idlist)" > $W/images.json
# mockup-generator's poetry launcher is broken on this machine ("Bad CPU type"); use its venv directly.
(cd $MG && .venv/bin/python -W ignore $here/fetch_drive_batch.py $W/urls.tsv $W 3) | tee $W/drive_manifest.tsv
for id in $(cat $ids); do
  d=$W/$id; mkdir -p $d/thumb
  for f in $d/orig_*(N); do
    [[ $f == *.jpg ]] && [[ $(sips -g pixelWidth $f | awk '/pixelWidth/{print $2}') -le 1600 ]] && continue
    sips -s format jpeg -Z 1600 $f --out ${f:r}.jpg >/dev/null; [[ $f != *.jpg ]] && rm $f
  done
  u=$(node -e 'const r=require(process.argv[1]).filter(x=>x.productid==process.argv[2]).sort((a,b)=>a.displayorder-b.displayorder)[0];console.log(r?r.imageurl:"")' $W/images.json $id)
  [[ -n $u ]] && curl -sf -o $d/mockup_1.webp "$u"
  for f in $d/orig_*.jpg(N) $d/mockup_1.webp(N); do sips -s format jpeg -s formatOptions 70 -Z 420 $f --out $d/thumb/${f:t:r}.jpg >/dev/null; done
done
echo "prepared $(wc -l < $ids | tr -d ' ') products in $W"
