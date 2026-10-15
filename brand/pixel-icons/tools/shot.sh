#!/bin/bash
# shot.sh <out.png> <w> <h> <url> : headless Chrome screenshot with a fresh profile; kills Chrome once the file lands.
out=$1; w=$2; h=$3; url=$4
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
prof=$(mktemp -d "${TMPDIR:-/tmp}/shotprof.XXXX") || { echo "FAIL mktemp"; exit 1; }
rm -f "$out"
"$CH" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
  --user-data-dir="$prof" --default-background-color=00000000 --force-device-scale-factor=1 \
  --virtual-time-budget=${VTB:-1500} --window-size=$w,$h --screenshot="$out" "$url" >/dev/null 2>&1 &
pid=$!
for i in $(seq 1 ${WAIT:-60}); do [ -s "$out" ] && sleep 0.5 && break; sleep 0.5; done
kill $pid 2>/dev/null; sleep 0.3; pkill -9 -f "user-data-dir=$prof" 2>/dev/null; rm -rf "$prof"
[ -s "$out" ] && echo "ok $out" || echo "FAIL $out"
