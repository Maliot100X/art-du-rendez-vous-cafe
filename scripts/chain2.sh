#!/bin/bash
cd "$(dirname "$0")/.."
while pgrep -f "tabs-mobile.sh" >/dev/null; do sleep 3; done
echo "== rec"; WARM=12000 timeout 900 node scripts/rec-livre.mjs
echo "== transition"; timeout 600 node scripts/transition.mjs
echo "== galerie"; HASH="#/galerie" WAIT=12000 timeout 600 node scripts/section.mjs "#galerie" 0.5 tab-4-galerie-mid 1440 900 qa/tabs
echo "== hero video"; timeout 900 node scripts/qa.mjs video
