#!/usr/bin/env bash
# Validate, type-check and test every mod (or only the mod folders named).
# CLAUDE_BIN: a Claude Code 2.1.287+ binary. CLAUDE_TYPES: the engine's claude-code.d.ts (tsc is skipped without it).
# STRICT=1: validate --strict (warnings fail), as CI runs it.
set -uo pipefail
cd "$(dirname "$0")/.."
CC="${CLAUDE_BIN:-claude}"
TYPES="${CLAUDE_TYPES:-.cache/claude-code.d.ts}"
if [ $# -gt 0 ]; then mods=("$@"); else mods=(mods/*/); fi
fail=0
checked=0
for m in "${mods[@]}"; do
  m="${m%/}"
  if [ ! -f "$m/.claude-plugin/plugin.json" ]; then
    # A named folder that is not a mod is an error, never a silent pass.
    if [ $# -gt 0 ]; then echo "!! not a mod folder: $m"; fail=1; fi
    continue
  fi
  checked=$((checked + 1))
  echo "== $m"
  "$CC" plugin validate ${STRICT:+--strict} "$m" || { echo "!! validate failed: $m"; fail=1; }
  if [ -f "$TYPES" ]; then
    mkdir -p "$m/.claude-plugin/types/claude-code"
    cp "$TYPES" "$m/.claude-plugin/types/claude-code/index.d.ts"
    npx --no-install tsc -p "$m" || { echo "!! tsc failed: $m"; fail=1; }
  else
    echo "-- skip tsc: no engine types at $TYPES (Claude Code writes them when a mod loads from your folder)"
  fi
  "$CC" plugin test "$m" || { echo "!! test failed: $m"; fail=1; }
done
if [ "$checked" -eq 0 ]; then echo "!! no mods checked"; fail=1; fi
echo "checked $checked mod(s), $([ $fail -eq 0 ] && echo 'all green' || echo 'FAILURES above')"
exit $fail
