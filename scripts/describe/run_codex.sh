#!/bin/zsh
# First pass with Codex (ChatGPT Plus login, not an API key).
# usage: scripts/describe/run_codex.sh <productid> [model=gpt-5.6-terra] [work_dir=.describe-work]
set -euo pipefail
here=${0:A:h}; repo=${here:h:h}; id=$1; model=${2:-gpt-5.6-terra}; W=${3:-$repo/.describe-work}; W=${W:A}
cd $W/$id
node $here/build_prompt.js $W/products.json $id $here/prompt.md > prompt.txt
imgs=(); for f in orig_*.jpg(N) mockup_*(N); do imgs+=(-i $f); done
# env -u: never fall back to API billing. < /dev/null: codex exec otherwise waits on stdin when backgrounded.
env -u OPENAI_API_KEY codex exec --skip-git-repo-check -s read-only -m $model $imgs \
  --output-schema $here/schema.json -o out_codex.json "$(cat prompt.txt)" < /dev/null > log_codex.txt 2>&1
sess=$(grep -m1 "session id:" log_codex.txt | awk '{print $3}')
f=$(ls ~/.codex/sessions/*/*/*/*$sess*.jsonl)
{ grep -oE '"total_token_usage":\{[^}]*\}' $f | tail -1; grep -oE '"primary":\{"used_percent":[0-9.]+' $f | tail -1; } > usage_codex.txt
