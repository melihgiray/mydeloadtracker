#!/usr/bin/env bash
# One-shot Sleek design run. Sleek bills per run, so this sends the whole
# app as a single message (scripts/sleek-brief.txt) rather than a
# conversation. See docs/DESIGN_PLAN.md for why.
#
# Usage:
#   SLEEK_API_KEY=sk_... ./scripts/sleek-run.sh refs            # list styles
#   SLEEK_API_KEY=sk_... ./scripts/sleek-run.sh go [referenceId]
set -euo pipefail

: "${SLEEK_API_KEY:?Set SLEEK_API_KEY first}"
API="https://sleek.design/api/v1"
AUTH=(-H "Authorization: Bearer $SLEEK_API_KEY" -H "Content-Type: application/json")
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-go}" in
refs)
  curl -s "${AUTH[@]}" "$API/references?limit=50" \
    | python3 -c 'import sys,json;[print(f"{r[\"id\"]}  {r[\"name\"]}\n    {(r.get(\"previewImageUrls\") or [\"\"])[0]}") for r in json.load(sys.stdin)["data"]]'
  ;;
go)
  REF="${2:-}"
  echo "Creating project..."
  PROJ=$(curl -s -X POST "${AUTH[@]}" "$API/projects" -d '{"name":"MyDeloadTracker"}' \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["id"])')
  echo "  project: $PROJ"
  echo "  watch live: https://sleek.design/project/$PROJ"

  BODY=$(python3 - "$DIR/scripts/sleek-brief.txt" "$REF" << 'PY'
import json, sys
text = open(sys.argv[1]).read()
payload = {"message": {"text": text}, "source": "claude-code"}
if len(sys.argv) > 2 and sys.argv[2]:
    payload["referenceId"] = sys.argv[2]
print(json.dumps(payload))
PY
)
  echo "Sending the brief (one run)..."
  RUN=$(curl -s -X POST "${AUTH[@]}" "$API/projects/$PROJ/chat/messages" -d "$BODY" \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",{}).get("runId") or json.dumps(d))')
  echo "  run: $RUN"

  echo "Polling..."
  for i in $(seq 1 90); do
    sleep 5
    OUT=$(curl -s "${AUTH[@]}" "$API/projects/$PROJ/chat/runs/$RUN")
    ST=$(printf '%s' "$OUT" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["status"])')
    printf "  [%3ds] %s\n" $((i*5)) "$ST"
    [ "$ST" = "completed" ] && break
    if [ "$ST" = "failed" ]; then printf '%s' "$OUT" | python3 -m json.tool; exit 1; fi
  done

  printf '%s' "$OUT" > "$DIR/docs/design/run.json"
  IDS=$(printf '%s' "$OUT" | python3 -c '
import sys,json
ops=json.load(sys.stdin)["data"].get("result",{}).get("operations",[])
print(" ".join(sorted({o["componentId"] for o in ops if o.get("componentId")})))')
  echo "Screens: $IDS"

  for id in $IDS; do
    curl -s -X POST "${AUTH[@]}" "$API/screenshots" \
      -d "{\"componentIds\":[\"$id\"],\"projectId\":\"$PROJ\",\"background\":\"transparent\"}" \
      -o "$DIR/docs/design/$id.png"
    echo "  saved docs/design/$id.png"
  done
  ALL=$(printf '%s' "$IDS" | python3 -c 'import sys;print(json.dumps(sys.stdin.read().split()))' 2>/dev/null || true)
  echo "Done. Screenshots in docs/design/"
  ;;
esac
