#!/usr/bin/env bash
# Install every mod in the marketplace the way a person does, into a throwaway Claude Code config.
# Proves the marketplace resolves and each listed mod installs and enables. Never touches your own config:
# HOME and CLAUDE_CONFIG_DIR point at a temporary folder that is deleted afterwards.
# CLAUDE_BIN: a Claude Code 2.1.287+ binary.
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
REPO="$PWD"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/mod-smoke.XXXXXX")" || { echo "!! mktemp failed"; exit 1; }
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home" "$TMP/config"
export HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/config"

market="$(node -p "require('./.claude-plugin/marketplace.json').name")"
mods=()
while IFS= read -r m; do mods+=("$m"); done < <(node -e "for (const p of require('./.claude-plugin/marketplace.json').plugins) console.log(p.name)")
[ "${#mods[@]}" -gt 0 ] || { echo "!! the marketplace lists no mods"; exit 1; }

fail=0
"$CC" plugin validate "$REPO" >/dev/null || { echo "!! marketplace manifest does not validate"; fail=1; }
"$CC" plugin marketplace add "$REPO" --json >"$TMP/add.json" 2>&1 \
  || { echo "!! marketplace add failed:"; cat "$TMP/add.json"; exit 1; }
for m in "${mods[@]}"; do
  if "$CC" plugin install "$m@$market" --json >"$TMP/install.json" 2>&1; then
    echo "ok  $m"
  else
    echo "!! install failed: $m"; cat "$TMP/install.json"; fail=1
  fi
done

# Every listed mod must show up installed and enabled.
"$CC" plugin list --json >"$TMP/list.json" 2>/dev/null || { echo "!! plugin list failed"; exit 1; }
node -e '
  const [list, market, ...want] = [JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), ...process.argv.slice(2)]
  const have = new Map(list.map(p => [p.id, p]))
  const bad = want.filter(m => !have.get(`${m}@${market}`)?.enabled)
  if (bad.length) { console.log(`!! not installed and enabled: ${bad.join(", ")}`); process.exit(1) }
' "$TMP/list.json" "$market" "${mods[@]}" || fail=1

echo "installed ${#mods[@]} mod(s) from $market, $([ $fail -eq 0 ] && echo 'all green' || echo 'FAILURES above')"
exit $fail
