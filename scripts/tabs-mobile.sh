#!/bin/bash
cd "$(dirname "$0")/.."
export BASE=${BASE:-http://127.0.0.1:4317/}
while pgrep -f "tabs3.sh|rec-livre" >/dev/null; do sleep 3; done
run() { echo "== $3"; HASH="$1" WAIT=${WAIT:-12000} timeout 700 node scripts/section.mjs "$2" "$4" "$3" 390 844 qa/tabs; }
run "#/" none mobile-1-accueil 0
run "#/carte" "#carte" mobile-2-carte 0.2
run "#/livre" "#livre" mobile-3-livre 0.4
run "#/galerie" "#galerie" mobile-4-galerie 0.1
run "#/commande" none mobile-5-commande 0
run "#/venir" "#venir-map" mobile-6-venir 0.3
