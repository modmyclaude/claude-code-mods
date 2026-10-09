// .env files: which ones to read at session start, how to parse them, and
// which of their values are worth hiding everywhere for the session.

import { isLearnable, isPlaceholder } from './detect'

/** `.env`, `.env.local`, `.env.production`: the names cloakroom reads. */
export function isEnvFileName(name: string): boolean {
  return name === '.env' || (name.startsWith('.env.') && name.length > 5)
}

/** Folders never worth listing for .env files (big, generated or vendored). */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.nuxt', '.turbo', '.cache', 'coverage', '.idea', '.vscode', 'Pods', '.terraform',
])

/** The secret-looking variable names the spec names, matched anywhere in the name. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIAL|DSN|PRIVATE/i
const PASSWORD_NAME = /PASSWORD|PASS|PWD/i

export function isSecretName(name: string): boolean {
  return SECRET_NAME.test(name)
}

/**
 * Whether a .env value is worth hiding everywhere it appears this session: a
 * learnable value (see isLearnable: not a path, a short value, a common default
 * like `postgres` or a low-entropy word), not a placeholder, and not a bare
 * number under a non-password name. A weak one is still hidden where it sits
 * next to its name (`DB_PASSWORD=hunter2`), by shape.
 */
export function isWorthHiding(name: string, value: string): boolean {
  if (!isLearnable(value) || isPlaceholder(value)) return false
  if (/^\d+$/.test(value) && !PASSWORD_NAME.test(name)) return false // TOKEN_TTL=86400000
  return true
}

export type EnvPair = { name: string; value: string }

const LINE = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.-]{0,127})[ \t]*=[ \t]*(.*)$/

/**
 * Parses dotenv text: `KEY=value`, `export KEY=value`, single, double and
 * backtick quotes (double quotes unescape `\n`, and may span lines, as a PEM
 * key often does), and ` # comments` after unquoted values.
 */
export function parseDotenv(text: string): EnvPair[] {
  const lines = text.split(/\r?\n/)
  const out: EnvPair[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = LINE.exec(lines[i] ?? '')
    if (!m) continue
    const name = m[1]!
    let rest = m[2] ?? ''
    const quote = rest[0]
    if (quote === '"' || quote === "'" || quote === '`') {
      let body = rest.slice(1)
      let close = closingQuote(body, quote)
      // A quoted value may run over several lines (up to 200).
      let extra = 0
      while (close < 0 && i + 1 < lines.length && extra < 200) {
        i++
        extra++
        body += '\n' + (lines[i] ?? '')
        close = closingQuote(body, quote)
      }
      if (close < 0) continue // unterminated: not a value we can trust
      let value = body.slice(0, close)
      if (quote === '"') {
        value = value.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c] ?? c)
      }
      out.push({ name, value })
      continue
    }
    const hash = rest.search(/[ \t]#/)
    if (hash >= 0) rest = rest.slice(0, hash)
    out.push({ name, value: rest.trim() })
  }
  return out
}

function closingQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i++) {
    if (quote === '"' && body[i] === '\\') {
      i++
      continue
    }
    if (body[i] === quote) return i
  }
  return -1
}
