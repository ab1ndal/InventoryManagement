#!/bin/zsh
# Second opinion with Claude Sonnet (Claude Code, claude.ai login) for products flagged by flag_hard.js.
# usage: scripts/describe/run_claude.sh <productid> [work_dir=.describe-work]
set -euo pipefail
here=${0:A:h}; repo=${here:h:h}; id=$1; W=${2:-$repo/.describe-work}; W=${W:A}
cd $W/$id
imgs=$(for f in orig_*.jpg(N) mockup_*(N); do printf -- "- %s (%s)\n" "$W/$id/$f" "${f%.*}"; done)
flags=$(node -e 'const o=require(process.argv[1]);console.log(JSON.stringify({uncertain:o.uncertain,conflicts:o.conflicts,first_pass_description:o.description}))' $W/$id/out_codex.json)
{ echo "Use the Read tool to view every image below, then answer with the JSON only.\n$imgs\n"; cat prompt.txt
  echo "\nA first-pass model flagged these points; resolve them from the original photos where you can, otherwise keep them under uncertain: $flags"; } > claude_prompt.txt
env -u OPENAI_API_KEY claude -p --model sonnet --allowedTools Read --output-format json \
  --json-schema "$(cat $here/schema.json)" "$(cat claude_prompt.txt)" < /dev/null > claude.raw 2>&1
node -e 'const r=JSON.parse(require("fs").readFileSync("claude.raw","utf8"));require("fs").writeFileSync("out_claude.json",JSON.stringify(r.structured_output));console.log(process.argv[1],"usd",r.total_cost_usd)' $id
