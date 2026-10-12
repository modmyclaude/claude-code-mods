// Secret redaction: the same as crossroads's (hooks/logic.ts, "secret redaction") and pop-quiz's,
// copied so this mod installs on its own. Keep the three in step: a fix to one is a fix to all.

export const REDACTED = '[REDACTED]'

// Token shapes with a fixed, recognisable prefix. Deliberately no "long hex"
// or "long base64" rule: git SHAs, UUIDs and hashes would all match it.
const TOKEN_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
  /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA|APKA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,255}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g,
  /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bSK[0-9a-f]{32}\b/g,
  // A Slack or Discord webhook URL is itself the credential.
  /\bhttps:\/\/(?:hooks\.slack\.com\/services|discord(?:app)?\.com\/api\/webhooks)\/\S+/g,
]

// `password=...`, `API_KEY: "..."`, `"client_secret": "..."`: the name must END
// in the keyword, so `max_tokens=5` and `author: Alex` are left alone.
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*?(?:password|passwd|pwd|pass|passphrase|secret|secret_key_base|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credentials?))(["']?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;&]+)/gi
const AUTH_HEADER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g
// GitHub's `Authorization: token ...`: only after the header name, so "token authentication" stays.
const TOKEN_HEADER = /(\bAuthorization\s*:\s*token\s+)[A-Za-z0-9._~+/=-]{12,}/gi
const URL_PASSWORD = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi
// `--password hunter2`, `--token=abc`: a secret-named flag and its value.
const FLAG_SECRET =
  /(\s--?(?:password|passwd|pass|pwd|token|secret|api[-_]?key|access[-_]?key|auth[-_]?token)[=\s]+)("[^"]*"|'[^']*'|\S+)/gi
// `mysql -phunter2` (the value glued to -p), and `curl -u user:pass`.
const MYSQL_P = /(\b(?:mysql|mysqldump|mariadb)\b[^\n]*?\s-p)(\S+)/g
const USER_PASS = /((?:\s-u\s+|\s--user[=\s]+)[^\s:]+:)(\S+)/g
// "my password is hunter2"
const SAID_PASSWORD = /\b(password|passphrase|passwd)(\s+(?:is|was)\s+)(\S+)/gi

/** Replaces anything that looks like a secret with a placeholder. */
export function redact(text: string): string {
  let out = text
  for (const shape of TOKEN_SHAPES) out = out.replace(shape, REDACTED)
  out = out.replace(ASSIGNMENT, (whole, name: string, sep: string, value: string) =>
    value.includes(REDACTED) ? whole : `${name}${sep}${REDACTED}`,
  )
  out = out.replace(AUTH_HEADER, `$1 ${REDACTED}`).replace(TOKEN_HEADER, `$1${REDACTED}`)
  out = out.replace(FLAG_SECRET, (whole, flag: string, value: string) => (value.includes(REDACTED) ? whole : `${flag}${REDACTED}`))
  out = out.replace(MYSQL_P, `$1${REDACTED}`).replace(USER_PASS, `$1${REDACTED}`)
  out = out.replace(SAID_PASSWORD, `$1$2${REDACTED}`)

  return out.replace(URL_PASSWORD, `$1${REDACTED}@`)
}

