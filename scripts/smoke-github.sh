#!/usr/bin/env bash
# Install from GitHub the two ways the README documents, each in its own throwaway Claude Code config,
# so a broken manifest or a stale branch shows up before a person hits it:
#   1. /plugin marketplace add modmyclaude/claude-code-mods, then every listed mod as <mod>@modmyclaude
#   2. /plugin install <mod> --marketplace modmyclaude/claude-code-mods, the one-liner, for one mod
# Reads origin's default branch, not this checkout. Never touches your own config: HOME and
# CLAUDE_CONFIG_DIR point at temporary folders that are deleted afterwards.
# CLAUDE_BIN: a Claude Code 2.1.287+ binary. SOURCE: the GitHub owner/repo (default modmyclaude/claude-code-mods).
set -uo pipefail
cd "$(dirname "$0")/.."
CC="${CLAUDE_BIN:-claude}"
SOURCE="${SOURCE:-modmyclaude/claude-code-mods}"
min=2.1.287
ver="$("$CC" --version 2>/dev/null | awk '{print $1}')"
if [ -z "$ver" ] || [ "$(printf '%s\n%s\n' "$min" "$ver" | sort -V | head -1)" != "$min" ]; then
  echo "!! $CC is Claude Code ${ver:-not found}; mods need $min or newer. Run claude update, or set CLAUDE_BIN."
  exit 1
fi
TMP="$(mktemp -d "${TMPDIR:-/tmp}/mod-smoke-github.XXXXXX")" || { echo "!! mktemp failed"; exit 1; }
trap 'rm -rf "$TMP"' EXIT
market="$(node -p "require('./.claude-plugin/marketplace.json').name")"
mods=()
while IFS= read -r m; do mods+=("$m"); done < <(node -e "for (const p of require('./.claude-plugin/marketplace.json').plugins) console.log(p.name)")
[ "${#mods[@]}" -gt 0 ] || { echo "!! the marketplace lists no mods"; exit 1; }
fail=0

# A fresh config for one install path.
fresh() {
  rm -rf "$TMP/home" "$TMP/config"
  mkdir -p "$TMP/home" "$TMP/config"
  export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/config"
}

# Every listed mod shows as installed and enabled.
enabled() {
  "$CC" plugin list --json >"$TMP/list.json" 2>/dev/null || { echo "!! plugin list failed"; return 1; }
  node -e '
    const [list, market, ...want] = [JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), ...process.argv.slice(2)]
    const have = new Map(list.map(p => [p.id, p]))
    const bad = want.filter(m => !have.get(`${m}@${market}`)?.enabled)
    if (bad.length) { console.log(`!! not installed and enabled: ${bad.join(", ")}`); process.exit(1) }
  ' "$TMP/list.json" "$market" "$@"
}

echo "1. marketplace add $SOURCE, then every listed mod"
fresh
if "$CC" plugin marketplace add "$SOURCE" --json >"$TMP/add.json" 2>&1; then
  for m in "${mods[@]}"; do
    if "$CC" plugin install "$m@$market" --json >"$TMP/install.json" 2>&1; then echo "ok  $m@$market"; else echo "!! install failed: $m@$market"; cat "$TMP/install.json"; fail=1; fi
  done
  enabled "${mods[@]}" || fail=1
else
  echo "!! marketplace add $SOURCE failed:"; cat "$TMP/add.json"; fail=1
fi

echo "2. the one-liner: plugin install ${mods[0]} --marketplace $SOURCE"
fresh
if "$CC" plugin install "${mods[0]}" --marketplace "$SOURCE" --json >"$TMP/one.json" 2>&1; then
  echo "ok  ${mods[0]} --marketplace $SOURCE"
  enabled "${mods[0]}" || fail=1
else
  echo "!! the one-liner failed:"; cat "$TMP/one.json"; fail=1
fi

echo "installed from $SOURCE both ways: $([ $fail -eq 0 ] && echo 'all green' || echo 'FAILURES above')"
exit $fail
