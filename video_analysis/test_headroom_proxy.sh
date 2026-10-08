#!/usr/bin/env bash
# Verify headroom-proxy: same Anthropic tool_result payload direct-to-OmniRoute vs via proxy.
# Body: video_analysis/body2.json (500-item repetitive JSON in a tool_result block preceded by
# assistant tool_use; unique outlier item 250 holds the marker answer "Keth City").
set -u
W=/home/dzerok/Documents/deepseek-harness/default-workspace/video_analysis
KEY=$(grep -E '^[[:space:]]+OR_API_KEY:' /home/dzerok/.dsh/.credentials.yaml | head -1 | sed -E 's/^[[:space:]]*OR_API_KEY:[[:space:]]*//; s/^"//; s/"$//')
[ -n "$KEY" ] || { echo "NO_KEY"; exit 2; }
[ -f "$W/body2.json" ] || { echo "MISSING_BODY (needs body2.json, tool_result shape)"; exit 3; }
BODY=$(cat "$W/body2.json")
PY=$(command -v python3)
echo "== body bytes: ${#BODY}"

parse() { $PY -c 'import json,sys
raw=sys.stdin.read()
code=raw.rsplit("__HTTP",1)[-1].strip("_")
body=raw.rsplit("__HTTP",1)[0]
print("HTTP",code)
try:
  d=json.loads(body)
  u=d.get("usage",{})
  print("input_tokens:",u.get("input_tokens",u.get("prompt_tokens")),"| output_tokens:",u.get("output_tokens",u.get("completion_tokens")))
  txt="".join(x.get("text","") for x in d.get("content",[]) if isinstance(x,dict))
  print("answer:",txt[:160])
  print("marker_kept:","Keth" in txt)
except Exception as e:
  print("PARSE_FAIL",e,body[:300])'
}

call() { # $1 url $2 label $3 header-dump-file(-)
  local url=$1 label=$2 hdr=$3
  local hdrargs=(); [ "$hdr" != "-" ] && hdrargs=(-D "$hdr")
  resp=$(curl -sS "${hdrargs[@]}" -X POST "$url/v1/messages" \
    -H "content-type: application/json" -H "x-api-key: $KEY" \
    -H "anthropic-version: 2023-06-01" -d "$BODY" -w '\n__HTTP%{http_code}__')
  echo "--- $label"
  echo "$resp" | parse
}

call http://localhost:20128 DIRECT -
call http://localhost:8787 VIA-PROXY "$W/hr_headers.txt"
echo "--- x-headroom response headers:"
grep -iE 'x-headroom' "$W/hr_headers.txt" || echo "(none)"
echo "== /stats:"
curl -sS http://127.0.0.1:8787/stats | $PY -c 'import json,sys
d=json.load(sys.stdin)["summary"];c=d["compression"]
print("api_requests:",d.get("api_requests"),"| compressed:",c.get("requests_compressed"),"| avg_pct:",c.get("avg_compression_pct"),"| saved_all_layers:",c.get("total_tokens_saved_all_layers"))'
