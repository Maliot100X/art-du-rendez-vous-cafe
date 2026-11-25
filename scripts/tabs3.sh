#!/bin/bash
cd "$(dirname "$0")/.."
export BASE=${BASE:-http://127.0.0.1:4317/}
while pgrep -f tabs2.sh >/dev/null; do sleep 3; done
run() { echo "== $3"; HASH="$1" WAIT=${WAIT:-14000} timeout 600 node scripts/section.mjs "$2" "$4" "$3" ${5:-1440} ${6:-900} qa/tabs; }
run "#/livre" "#livre" tab-3-livre 0.4
run "#/commande" none tab-5-commande 0
run "#/galerie" "#galerie" tab-4-galerie 0.05,0.5
echo "== rec"; timeout 900 node scripts/rec-livre.mjs
