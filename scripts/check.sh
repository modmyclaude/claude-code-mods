#!/usr/bin/env bash
# Validate, type-check and test every mod (or only the mod folders named).
# CLAUDE_BIN: a Claude Code 2.1.287+ binary. CLAUDE_TYPES: the engine's claude-code.d.ts (tsc is skipped without it).
# STRICT=1: validate --strict (warnings fail), as CI runs it.
set -uo pipefail
cd "$(dirname "$0")/.."
CC="${CLAUDE_BIN:-claude}"
# Mods need Claude Code 2.1.287+: say so plainly instead of failing on an unknown option.
min=2.1.287
ver="$("$CC" --version 2>/dev/null | awk '{print $1}')"
if [ -z "$ver" ] || [ "$(printf '%s\n%s\n' "$min" "$ver" | sort -V | head -1)" != "$min" ]; then
  echo "!! $CC is Claude Code ${ver:-not found}; mods need $min or newer. Run claude update, or set CLAUDE_BIN."
  exit 1
fi
TYPES="${CLAUDE_TYPES:-.cache/claude-code.d.ts}"
# The types file says which Claude Code wrote it (its first line); empty when it does not.
types_ver=""
[ -f "$TYPES" ] && types_ver="$(head -1 "$TYPES" | grep -o -E '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
# True when version $1 is below version $2 (both dotted; an empty $2 is no floor).
below() { [ -n "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -1)" != "$2" ]; }
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
  # A mod whose prompt names `full_from: <version>` uses an API that Claude Code brought at that
  # version. Below it the mod still loads and runs, less that feature, and the validator says so as
  # a warning (a hook on a component the engine lacks never runs), so --strict is lifted there, and
  # tsc is skipped where the types on hand are older than that API.
  floor="$(grep -m1 '^full_from:' "prompts/$(basename "$m").md" 2>/dev/null | awk '{print $2}')"
  strict="${STRICT:+--strict}"
  if below "$ver" "$floor"; then
    echo "-- $m is whole from Claude Code $floor; on $ver its newer hooks never run, which validate says as a warning, so --strict is lifted here"
    strict=""
  fi
  "$CC" plugin validate $strict "$m" || { echo "!! validate failed: $m"; fail=1; }
  if [ ! -f "$TYPES" ]; then
    echo "-- skip tsc: no engine types at $TYPES (Claude Code writes them when a mod loads from your folder)"
  elif below "${types_ver:-$ver}" "$floor"; then
    echo "-- skip tsc: $m is whole from Claude Code $floor and the types at $TYPES are ${types_ver:-of an unknown version}"
  else
    mkdir -p "$m/.claude-plugin/types/claude-code"
    cp "$TYPES" "$m/.claude-plugin/types/claude-code/index.d.ts"
    npx --no-install tsc -p "$m" || { echo "!! tsc failed: $m"; fail=1; }
  fi
  "$CC" plugin test "$m" || { echo "!! test failed: $m"; fail=1; }
done
if [ "$checked" -eq 0 ]; then echo "!! no mods checked"; fail=1; fi
echo "checked $checked mod(s), $([ $fail -eq 0 ] && echo 'all green' || echo 'FAILURES above')"
exit $fail
