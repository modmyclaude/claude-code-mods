// Pattern detectors for secrets, written from public knowledge of key formats.
//
// Linear time is a hard rule here, because the text is often hostile (a web
// page, a log, a file someone else wrote):
// - every quantifier is bounded ({m,n}), none is nested;
// - each pattern starts only at the edge of a run (a lookbehind), so a long run
//   of matching characters is tried once, not once per character;
// - a cheap `includes` gate skips a pattern whose anchor text is absent.
// The worst case is then a small constant times the text length; the 5 MB
// adversarial test in tests/perf.test.ts holds that to account.

export type Hit = {
  start: number
  end: number
  /** Ticket label base: the variable name, or the format's usual name. */
  name: string
  /** A plain-words kind for listings ("Stripe secret key"). */
  kind: string
  /** Lower wins when two hits cover the same text. */
  rank: number
  /** The public prefix of the format, shown in audit previews (`sk_live_`). */
  prefix?: string
}

type Rule = {
  name: string
  kind: string
  /** Anchor texts: the pattern only runs when one of them is in the text. */
  hints: readonly string[]
  re: RegExp
  /** The secret is the last capture group, which ends the match. */
  tail?: boolean
  /** The public prefix of a value, for previews. */
  prefix?: RegExp
  check?: (value: string) => boolean
}

// ------------------------------------------------------------- value tests

const LOWER = /[a-z]/
const UPPER = /[A-Z]/
const DIGIT = /[0-9]/
const SYMBOL = /[^A-Za-z0-9]/

/** Shannon entropy in bits per character. */
export function entropy(value: string): number {
  if (value.length === 0) return 0
  const counts = new Map<string, number>()
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let bits = 0
  for (const n of counts.values()) {
    const p = n / value.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** Words people put where a secret will go later, and values that are code, not data. */
const PLACEHOLDER =
  /^(?:x{3,}|\*{3,}|\.{3,}|-+|_+|changeme|change[-_ ]?me|replace[-_ ]?me|your[-_ ][\w -]*|<[^>]*>|\$\{[^}]*\}?|\$\([^)]*\)?|\$[A-Za-z_][A-Za-z0-9_]*|\{\{[^}]*\}?\}?|%[A-Za-z_]+%|todo|tbd|none|null|nil|true|false|yes|no|on|off|undefined|placeholder|redacted|hidden|masked|secret|secrets|password|passwd|token|apikey|api_key|string|str|number|int|integer|boolean|bool|object|any|required|optional|empty|dummy|fake|test|testing|sample|default|foo|bar|baz|qux|abc|abcd|1234|12345|123456|enter[-_ ][\w -]*|insert[-_ ][\w -]*)$/i

/**
 * `process.env.X`, `config.apiKey`, `req.body.password`: a reference in code,
 * not a value. The first part is a plain word; a token's first part
 * (`aZ7Lr...9.xyz`) has digits in it.
 */
const CODE_REF = /^(?:[A-Za-z_$][A-Za-z_$]{0,30}(?:\.[A-Za-z_$][\w$]{0,63}){1,8}|os\.environ.*|process\.env.*|env\(.*|getenv.*)$/

/** A placeholder, an example, or a run of one character: never a real secret. */
export function isPlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true
  if (/example/i.test(value)) return true // AWS's documented AKIA...EXAMPLE and kin
  if (/^\[secret:/.test(value)) return true
  if (/^(.)\1+$/.test(value)) return true // "aaaaaaaa"
  return false
}

/**
 * A filesystem path: `/Users/dev/app`, `~/x`, `./x`, `../x`, `C:\x`, or
 * folders then a file name (`certs/dev.pem`). `PWD`, `OLDPWD` and
 * `PASSWORD_STORE_DIR` hold one, and a path is never the secret itself.
 */
export function isPathLike(value: string): boolean {
  if (/^(?:~|\.{1,2})?[\\/]|^~$|^[A-Za-z]:[\\/]/.test(value)) return true
  const parts = value.split('/')
  return parts.length > 1 && parts.every(p => /^[\w-][\w.-]*$/.test(p)) && /\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(value)
}

/** Defaults people leave in dev .env files, compared without case or a trailing `123`/`!`. */
const COMMON_DEFAULTS = new Set([
  'postgres', 'postgresql', 'mysql', 'mariadb', 'mongodb', 'redis', 'rabbitmq', 'docker', 'password', 'passw0rd',
  'admin', 'administrator', 'root', 'toor', 'guest', 'user', 'secret', 'supersecret', 'mysecret', 'secretkey',
  'changeme', 'example', 'test', 'testing', 'localhost', 'development', 'production', 'staging', 'default',
  'true', 'false', 'null', 'undefined', 'letmein', 'welcome', 'qwerty', 'qwertyuiop', 'iloveyou', 'trustno1',
])

/** Shortest value hidden everywhere it appears; a shorter one is hidden only where a detector finds it. */
export const MIN_LEARN_CHARS = 8
/**
 * Shannon entropy of a value's own characters is at most log2(length), so at
 * the 8-character floor 3.0 bits means eight distinct characters. Words and
 * defaults score under it (postgres 2.75, localhost 2.73, supersecret 2.66,
 * password1 2.95), while a random 12-character token from a 36-symbol
 * alphabet averages 3.3 (about 1 in 20 falls under 3.0 and is then hidden
 * only by shape) and longer or richer tokens score higher still.
 */
export const MIN_LEARN_ENTROPY = 3.0

/**
 * Whether a value may be learned: matched everywhere it appears for the rest
 * of the session, not only where a detector finds it. A path, a short value, a
 * common default or a low-entropy word would mask unrelated text (the project
 * path in every build log, `postgres` in every image name), so it is not.
 */
export function isLearnable(value: string): boolean {
  if (value.length < MIN_LEARN_CHARS || isPathLike(value)) return false
  if ('01234567890'.includes(value) || '9876543210'.includes(value)) return false // 12345678
  const word = value.toLowerCase()
  if (COMMON_DEFAULTS.has(word) || COMMON_DEFAULTS.has(word.replace(/[^a-z]+$/, ''))) return false // Postgres123!
  return entropy(value) >= MIN_LEARN_ENTROPY - 1e-9 // eight distinct characters score exactly 3.0
}

/** A value written next to a name may also be code that reads one. */
function isPlaceholderOrCode(value: string): boolean {
  return isPlaceholder(value) || CODE_REF.test(value)
}

/** Upper, lower and digit together: what a random base62 key nearly always has. */
function mixedClasses(value: string): boolean {
  return LOWER.test(value) && UPPER.test(value) && DIGIT.test(value)
}

/** An opaque token, not a word, a placeholder or an environment variable's name. */
function tokenish(value: string): boolean {
  if (isPlaceholder(value)) return false
  if (/^[A-Z0-9_]+$/.test(value) && value.includes('_')) return false // MY_API_TOKEN
  return DIGIT.test(value) || (LOWER.test(value) && UPPER.test(value))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_INDEX = new Map([...B64].map((c, i) => [c, i] as const))

/** Decodes standard base64 (padding optional); undefined when it is not base64. */
export function decodeBase64(text: string): Uint8Array | undefined {
  const clean = text.replace(/=+$/, '')
  if (clean.length % 4 === 1) return undefined
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let bits = 0
  let acc = 0
  let o = 0
  for (const ch of clean) {
    const v = B64_INDEX.get(ch)
    if (v === undefined) return undefined
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (acc >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

/** Base64 of `user:password`, all printable: what a Basic auth header carries. */
function basicDecodes(value: string): boolean {
  const bytes = decodeBase64(value)
  if (!bytes || bytes.length < 3) return false
  let colon = -1
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0
    if (b < 0x20 || b > 0x7e) return false
    if (b === 0x3a && colon < 0) colon = i
  }
  return colon >= 0 && colon < bytes.length - 1
}

// ------------------------------------------------------------ vendor rules

// Each rule is the format's public shape: a fixed prefix, then a bounded run.
const RULES: readonly Rule[] = [
  {
    name: 'AWS_ACCESS_KEY_ID',
    kind: 'AWS access key ID',
    hints: ['AKIA', 'ASIA', 'ABIA', 'ACCA'],
    re: /(?<![A-Z0-9])(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
    prefix: /^A[A-Z]{3}/,
    check: v => !isPlaceholder(v),
  },
  {
    name: 'GITHUB_TOKEN',
    kind: 'GitHub token',
    hints: ['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_'],
    re: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36,251}|github_pat_[A-Za-z0-9_]{22,251})(?![A-Za-z0-9_])/g,
    prefix: /^(?:gh[pousr]_|github_pat_)/,
  },
  {
    name: 'ANTHROPIC_API_KEY',
    kind: 'Anthropic API key',
    hints: ['sk-ant-'],
    re: /(?<![A-Za-z0-9_-])sk-ant-[a-z0-9]{2,12}-[A-Za-z0-9_-]{20,300}/g,
    prefix: /^sk-ant-[a-z0-9]{2,12}-/,
  },
  {
    name: 'OPENAI_API_KEY',
    kind: 'OpenAI API key',
    hints: ['sk-'],
    re: /(?<![A-Za-z0-9_-])sk-(?:(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,300}|[A-Za-z0-9]{32,64}(?![A-Za-z0-9_-]))/g,
    prefix: /^sk-(?:proj-|svcacct-|admin-)?/,
  },
  {
    name: 'STRIPE_SECRET_KEY',
    kind: 'Stripe secret key',
    hints: ['k_live_', 'k_test_'],
    // Secret (sk_) and restricted (rk_) keys. Publishable pk_ keys are public by design.
    re: /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{10,247}/g,
    prefix: /^[sr]k_(?:live|test)_/,
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    kind: 'Stripe webhook secret',
    hints: ['whsec_'],
    re: /(?<![A-Za-z0-9_])whsec_[A-Za-z0-9+/=]{20,100}/g,
    prefix: /^whsec_/,
  },
  {
    name: 'SLACK_TOKEN',
    kind: 'Slack token',
    hints: ['xox'],
    re: /(?<![A-Za-z0-9_-])xox[abposre]-[A-Za-z0-9-]{10,250}/g,
    prefix: /^xox[a-z]-/,
  },
  {
    name: 'SLACK_APP_TOKEN',
    kind: 'Slack app token',
    hints: ['xapp-'],
    re: /(?<![A-Za-z0-9_-])xapp-[0-9]-[A-Za-z0-9-]{10,250}/g,
    prefix: /^xapp-/,
  },
  {
    name: 'SLACK_WEBHOOK_URL',
    kind: 'Slack webhook URL',
    hints: ['hooks.slack.com'],
    re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{20,250}/g,
    prefix: /^https:\/\/hooks\.slack\.com\//,
  },
  {
    name: 'GOOGLE_API_KEY',
    kind: 'Google API key',
    hints: ['AIza'],
    re: /(?<![A-Za-z0-9_-])AIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g,
    prefix: /^AIza/,
  },
  {
    name: 'GOOGLE_CLIENT_SECRET',
    kind: 'Google OAuth client secret',
    hints: ['GOCSPX-'],
    re: /(?<![A-Za-z0-9_-])GOCSPX-[A-Za-z0-9_-]{28}(?![A-Za-z0-9_-])/g,
    prefix: /^GOCSPX-/,
  },
  {
    name: 'GOOGLE_OAUTH_TOKEN',
    kind: 'Google OAuth access token',
    hints: ['ya29.'],
    re: /(?<![A-Za-z0-9_-])ya29\.[A-Za-z0-9_-]{20,2048}/g,
    prefix: /^ya29\./,
  },
  {
    name: 'TWILIO_API_KEY',
    kind: 'Twilio API key',
    hints: ['SK'],
    re: /(?<![A-Za-z0-9])SK[0-9a-f]{32}(?![A-Za-z0-9])/g,
    prefix: /^SK/,
  },
  {
    name: 'RESEND_API_KEY',
    kind: 'Resend API key',
    hints: ['re_'],
    re: /(?<![A-Za-z0-9_])re_[A-Za-z0-9]{6,24}_[A-Za-z0-9]{16,64}(?![A-Za-z0-9_])/g,
    prefix: /^re_/,
    check: mixedClasses, // keeps snake_case names like re_compile_pattern_cache out
  },
  {
    name: 'SENDGRID_API_KEY',
    kind: 'SendGrid API key',
    hints: ['SG.'],
    re: /(?<![A-Za-z0-9_-])SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
    prefix: /^SG\./,
  },
  {
    name: 'MAILGUN_API_KEY',
    kind: 'Mailgun API key',
    hints: ['key-'],
    re: /(?<![A-Za-z0-9_-])key-[0-9a-f]{32}(?![A-Za-z0-9])/g,
    prefix: /^key-/,
  },
  {
    name: 'NPM_TOKEN',
    kind: 'npm token',
    hints: ['npm_'],
    re: /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9_])/g,
    prefix: /^npm_/,
  },
  {
    name: 'PYPI_TOKEN',
    kind: 'PyPI token',
    hints: ['pypi-'],
    re: /(?<![A-Za-z0-9_-])pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,1000}/g,
    prefix: /^pypi-/,
  },
  {
    name: 'GITLAB_TOKEN',
    kind: 'GitLab token',
    hints: ['glpat-'],
    re: /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,64}/g,
    prefix: /^glpat-/,
  },
  {
    name: 'HUGGINGFACE_TOKEN',
    kind: 'Hugging Face token',
    hints: ['hf_'],
    re: /(?<![A-Za-z0-9_])hf_[A-Za-z]{34}(?![A-Za-z0-9_])/g,
    prefix: /^hf_/,
  },
  {
    name: 'DIGITALOCEAN_TOKEN',
    kind: 'DigitalOcean token',
    hints: ['_v1_'],
    re: /(?<![A-Za-z0-9_])do[opr]_v1_[a-f0-9]{64}(?![A-Za-z0-9_])/g,
    prefix: /^do[opr]_v1_/,
  },
  {
    name: 'SHOPIFY_TOKEN',
    kind: 'Shopify token',
    hints: ['shp'],
    re: /(?<![A-Za-z0-9_])shp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}(?![A-Za-z0-9_])/g,
    prefix: /^shp[a-z]{2}_/,
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    kind: 'Telegram bot token',
    hints: [':AA'],
    re: /(?<![0-9])[0-9]{8,10}:AA[A-Za-z0-9_-]{33}(?![A-Za-z0-9_-])/g,
  },
  {
    name: 'SQUARE_TOKEN',
    kind: 'Square token',
    hints: ['sq0'],
    re: /(?<![A-Za-z0-9_-])sq0(?:atp|csp)-[A-Za-z0-9_-]{22,43}(?![A-Za-z0-9_-])/g,
    prefix: /^sq0[a-z]{3}-/,
  },
  {
    name: 'DATABRICKS_TOKEN',
    kind: 'Databricks token',
    hints: ['dapi'],
    re: /(?<![A-Za-z0-9_])dapi[a-f0-9]{32}(?:-[0-9])?(?![A-Za-z0-9_])/g,
    prefix: /^dapi/,
  },
  {
    name: 'LINEAR_API_KEY',
    kind: 'Linear API key',
    hints: ['lin_api_'],
    re: /(?<![A-Za-z0-9_])lin_api_[A-Za-z0-9]{40}(?![A-Za-z0-9_])/g,
    prefix: /^lin_api_/,
  },
  {
    name: 'NOTION_TOKEN',
    kind: 'Notion token',
    hints: ['ntn_', 'secret_'],
    re: /(?<![A-Za-z0-9_])(?:ntn_[A-Za-z0-9]{40,50}|secret_[A-Za-z0-9]{43})(?![A-Za-z0-9_])/g,
    prefix: /^(?:ntn_|secret_)/,
    check: v => DIGIT.test(v),
  },
  {
    name: 'SUPABASE_TOKEN',
    kind: 'Supabase token',
    hints: ['sbp_'],
    re: /(?<![A-Za-z0-9_])sbp_[a-f0-9]{40}(?![A-Za-z0-9_])/g,
    prefix: /^sbp_/,
  },
  {
    name: 'GROQ_API_KEY',
    kind: 'Groq API key',
    hints: ['gsk_'],
    re: /(?<![A-Za-z0-9_])gsk_[A-Za-z0-9]{48,60}(?![A-Za-z0-9_])/g,
    prefix: /^gsk_/,
  },
  {
    name: 'XAI_API_KEY',
    kind: 'xAI API key',
    hints: ['xai-'],
    re: /(?<![A-Za-z0-9_-])xai-[A-Za-z0-9]{40,100}(?![A-Za-z0-9_-])/g,
    prefix: /^xai-/,
  },
  {
    name: 'POSTMAN_API_KEY',
    kind: 'Postman API key',
    hints: ['PMAK-'],
    re: /(?<![A-Za-z0-9_-])PMAK-[a-f0-9]{24}-[a-f0-9]{34}(?![A-Za-z0-9_-])/g,
    prefix: /^PMAK-/,
  },
  {
    name: 'DOPPLER_TOKEN',
    kind: 'Doppler token',
    hints: ['dp.'],
    re: /(?<![A-Za-z0-9_.-])dp\.(?:pt|st|sa|ct|scim|audit)\.[A-Za-z0-9]{40,50}(?![A-Za-z0-9_])/g,
    prefix: /^dp\.[a-z]+\./,
  },
  {
    name: 'JWT',
    kind: 'JSON Web Token',
    hints: ['eyJ'],
    re: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,4096}\.eyJ[A-Za-z0-9_-]{5,8192}\.[A-Za-z0-9_-]{0,4096}/g,
    prefix: /^eyJ/,
  },
  {
    name: 'BEARER_TOKEN',
    kind: 'Bearer token',
    hints: ['earer', 'EARER'],
    re: /(?<![A-Za-z0-9_])(?:[Bb]earer|BEARER)[ \t]{1,8}([A-Za-z0-9._~+/-]{16,4096}={0,4})/g,
    tail: true,
    check: tokenish,
  },
  {
    name: 'BASIC_AUTH',
    kind: 'Basic auth credentials',
    hints: ['asic', 'ASIC'],
    re: /(?<![A-Za-z0-9_])(?:[Bb]asic|BASIC)[ \t]{1,8}([A-Za-z0-9+/]{8,4096}={0,2})(?![A-Za-z0-9+/=])/g,
    tail: true,
    check: basicDecodes,
  },
]

const RANK_URL = RULES.length
const RANK_PEM = RULES.length + 1
const RANK_NAMED = RULES.length + 2

function hasAny(text: string, hints: readonly string[]): boolean {
  for (const hint of hints) if (text.includes(hint)) return true
  return false
}

function runRule(text: string, rule: Rule, rank: number, out: Hit[]): void {
  const re = rule.re
  re.lastIndex = 0
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const whole = m[0]
    const value = rule.tail ? (m[m.length - 1] ?? '') : whole
    const end = m.index + whole.length
    const start = end - value.length
    if (value.length === 0 || (rule.check && !rule.check(value))) continue
    const prefix = rule.prefix?.exec(value)?.[0]
    out.push({ start, end, name: rule.name, kind: rule.kind, rank, ...(prefix ? { prefix } : {}) })
  }
}

// ------------------------------------------------------- private key blocks

const PEM_BEGIN = '-----BEGIN '
const PEM_END = '-----END '
/** Base64 body, line breaks, and the `\n` of a key escaped inside JSON. */
const PEM_BODY = /[A-Za-z0-9+/=\s\\:,-]/
const PEM_MAX = 64 * 1024

function findPem(text: string, out: Hit[]): void {
  let pos = text.indexOf(PEM_BEGIN)
  let nextEnd = -2 // the next END marker at or after pos, found once and reused (linear)
  while (pos >= 0) {
    const labelEnd = text.indexOf('-----', pos + PEM_BEGIN.length)
    const label = labelEnd > 0 && labelEnd - pos < 80 ? text.slice(pos, labelEnd) : ''
    if (!label.includes('PRIVATE KEY')) {
      pos = text.indexOf(PEM_BEGIN, pos + 1)
      continue
    }
    if (nextEnd !== -1 && nextEnd < pos) nextEnd = text.indexOf(PEM_END, pos)
    let stop: number
    if (nextEnd >= 0 && nextEnd - pos <= PEM_MAX) {
      const close = text.indexOf('-----', nextEnd + PEM_END.length)
      stop = close >= 0 && close - nextEnd < 80 ? close + 5 : nextEnd + PEM_END.length
    } else {
      // No END marker (output cut short): hide the body as far as it runs.
      stop = labelEnd + 5
      const limit = Math.min(text.length, pos + PEM_MAX)
      while (stop < limit && PEM_BODY.test(text[stop] ?? '')) stop++
    }
    out.push({ start: pos, end: stop, name: 'PRIVATE_KEY', kind: 'Private key', rank: RANK_PEM, prefix: label + '-----' })
    pos = text.indexOf(PEM_BEGIN, stop)
  }
}

// ------------------------------------------------------- passwords in URLs

const URL_CRED = /(?<![A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]{1,30}):\/\/([^\s:/@'"<>`]{0,256}):([^\s/@'"<>`]{1,256})@/g

function findUrlPasswords(text: string, out: Hit[]): void {
  if (!text.includes('://')) return
  URL_CRED.lastIndex = 0
  for (let m = URL_CRED.exec(text); m !== null; m = URL_CRED.exec(text)) {
    const password = m[3] ?? ''
    if (isPlaceholder(password)) continue
    const end = m.index + m[0].length - 1 // just before the "@"
    const scheme = (m[1] ?? 'url').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
    out.push({ start: end - password.length, end, name: `${scheme}_PASSWORD`, kind: 'Password in a URL', rank: RANK_URL })
  }
}

// ------------------------------------------------- values next to a name

/** How strongly a variable's name says its value is secret. */
export type NameClass = 'password' | 'strong' | 'weak' | 'auth' | null

/** Splits `apiKey`, `X-API-Key`, `client_secret` into lowercase words. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const KEY_QUALIFIERS = new Set([
  'api', 'access', 'secret', 'private', 'signing', 'encryption', 'master', 'license', 'auth',
  'service', 'account', 'client', 'app', 'admin', 'live', 'webhook', 'session', 'subscription',
])

export function classifyName(name: string): NameClass {
  const parts = words(name)
  const joined = parts.join('')
  if (/passw(?:or)?d|passphrase/.test(joined) || parts.includes('pass') || parts.includes('pwd')) return 'password'
  if (/secret(?!ary)|apikey|credential|privatekey|accesskey|authtoken|accesstoken|refreshtoken/.test(joined)) {
    return 'strong'
  }
  if (parts.includes('token') || parts.includes('dsn')) return 'strong'
  if (parts.includes('key')) return parts.some(p => KEY_QUALIFIERS.has(p)) ? 'strong' : 'weak'
  if (joined === 'authorization' || joined === 'xauthorization') return 'auth'
  return null
}

const AUTH_SCHEMES = /^(?:bearer|basic|token|digest|negotiate|ntlm|hoba|mutual|aws4-hmac-sha256)$/i
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Whether `value`, written next to a name of class `cls`, looks like the secret itself. */
export function namedValueLooksSecret(cls: NameClass, value: string, isQuoted: boolean): boolean {
  // `PWD=/Users/dev/app` (a `pwd` name), `PASSWORD_STORE_DIR=~/.password-store`: a path, not the secret.
  if (cls === null || isPlaceholderOrCode(value) || isPathLike(value)) return false
  const isBareWord = !isQuoted && IDENTIFIER.test(value)
  switch (cls) {
    case 'password':
      // `password: hashedPassword` is code; `password: hunter2` and "pa55" quoted are not.
      if (value.length < 6) return false
      return isBareWord ? DIGIT.test(value) : true
    case 'strong':
      if (value.length < 8) return false
      if (/^[a-z][a-z-]*$/.test(value)) return false // a slug: some-config-name
      if (isBareWord && !DIGIT.test(value)) return false
      return DIGIT.test(value) || (LOWER.test(value) && UPPER.test(value)) || SYMBOL.test(value)
    case 'weak':
      return value.length >= 20 && DIGIT.test(value) && /[A-Za-z]/.test(value) && entropy(value) >= 3.5
    case 'auth':
      return value.length >= 12 && !AUTH_SCHEMES.test(value) && tokenish(value)
  }
}

/** Upper-snake label for a variable name: `process.env.apiKey` -> `APIKEY`. */
export function labelOf(name: string): string {
  const last = name.replace(/^-+/, '').split('.').pop() ?? name
  const label = last
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return label || 'SECRET'
}

// Phase one finds `name (quote) sep` pairs only; it never reads a value, so a
// name inside a value (`url: https://x?token=abc`) is still found. Phase two
// reads a value only after a secret-like name.
const NAME_SEP = /(?<![A-Za-z0-9_.$-])(-{0,2}[A-Za-z_$][A-Za-z0-9_.$-]{0,63})(?:\\?["'])?[ \t]{0,8}(?:=>|:=|=|:)[ \t]{0,8}/g

const VALUE_MAX = 512

/** A character an unquoted value may hold: not space, quote, bracket or separator. */
function isValueChar(code: number): boolean {
  if (code <= 0x20 || code === 0x7f || code === 0xa0 || code === 0x2028 || code === 0x2029 || code === 0xfeff) {
    return false
  }
  // " ' ` , ; & < > ( ) { } [ ] \
  return !(
    code === 0x22 || code === 0x27 || code === 0x60 || code === 0x2c || code === 0x3b || code === 0x26 ||
    code === 0x3c || code === 0x3e || code === 0x28 || code === 0x29 || code === 0x7b || code === 0x7d ||
    code === 0x5b || code === 0x5d || code === 0x5c
  )
}

/**
 * Reads values for one text. Unquoted values share one cache of the current
 * run of value characters, and starts only move forward, so every character
 * is scanned at most once however many names point into the same run.
 */
function valueReader(text: string) {
  let runFrom = -1
  let runTo = -1
  let runIsWhole = false
  const unquotedEnd = (q: number): number => {
    if (q < runFrom || q > runTo) {
      runFrom = q
      runTo = q
      runIsWhole = false
    }
    const cap = Math.min(text.length, q + VALUE_MAX)
    if (runIsWhole || runTo >= cap) return Math.min(runTo, cap)
    let i = runTo
    while (i < cap && isValueChar(text.charCodeAt(i))) i++
    runTo = i
    runIsWhole = i < cap || i === text.length
    return i
  }
  /** The value starting at `q`: its span and whether it was quoted. */
  return (q: number): { start: number; end: number; isQuoted: boolean } | undefined => {
    let at = q
    const first = text[at]
    if (first === '\\' && (text[at + 1] === '"' || text[at + 1] === "'")) {
      at += 2 // JSON-escaped quotes: the value runs to the next backslash
    } else if (first === '"' || first === "'") {
      // A quoted value may hold spaces; it ends at the same quote, within reach.
      const limit = Math.min(text.length, at + 1 + VALUE_MAX)
      let i = at + 1
      while (i < limit) {
        const c = text[i]
        if (c === first) return i > at + 1 ? { start: at + 1, end: i, isQuoted: true } : undefined
        if (c === '\\' || c === '\n' || c === '\r') break
        i++
      }
      at += 1 // unterminated: read it as an unquoted value
    } else if (first === '`') {
      at += 1
    }
    const end = unquotedEnd(at)
    return end > at ? { start: at, end, isQuoted: false } : undefined
  }
}

function findNamed(text: string, out: Hit[]): void {
  const readValue = valueReader(text)
  let hiddenTo = 0 // names inside a value already hidden are not read again
  NAME_SEP.lastIndex = 0
  for (let m = NAME_SEP.exec(text); m !== null; m = NAME_SEP.exec(text)) {
    if (m.index < hiddenTo) continue
    const rawName = m[1] ?? ''
    const cls = classifyName(rawName)
    if (cls === null) continue
    const span = readValue(m.index + m[0].length)
    if (!span) continue
    let { end } = span
    if (!span.isQuoted) {
      while (end > span.start && text[end - 1] === '.') end-- // a sentence's full stop
    }
    const value = text.slice(span.start, end)
    if (!namedValueLooksSecret(cls, value, span.isQuoted)) continue
    out.push({ start: span.start, end, name: labelOf(rawName), kind: 'Secret named in text', rank: RANK_NAMED })
    hiddenTo = end
  }
}

// --password s3cret, --api-key "abc": a flag, a space, the value.
const FLAG =
  /(?<![A-Za-z0-9_-])--(password|passwd|pass|token|api[-_]?key|secret|access[-_]token|auth[-_]token|client[-_]secret)[ \t]{1,4}(?:"([^"\\\r\n]{1,512})"|'([^'\\\r\n]{1,512})'|([^\s"'`;&|<>()]{1,512}))/g

function findFlags(text: string, out: Hit[]): void {
  FLAG.lastIndex = 0
  for (let m = FLAG.exec(text); m !== null; m = FLAG.exec(text)) {
    const quoted = m[2] ?? m[3]
    const value = quoted ?? m[4] ?? ''
    const isQuoted = quoted !== undefined
    const end = m.index + m[0].length - (isQuoted ? 1 : 0)
    const name = m[1] ?? 'secret'
    if (!isQuoted && value.startsWith('-')) continue // the next flag, not a value
    if (!namedValueLooksSecret(classifyName(name), value, isQuoted)) continue
    out.push({ start: end - value.length, end, name: labelOf(name), kind: 'Secret named in text', rank: RANK_NAMED })
  }
}

// ------------------------------------------------------------- everything

/** Every detector's hits in `text`, unordered and possibly overlapping. */
export function detect(text: string): Hit[] {
  const out: Hit[] = []
  RULES.forEach((rule, rank) => {
    if (hasAny(text, rule.hints)) runRule(text, rule, rank, out)
  })
  if (text.includes(PEM_BEGIN)) findPem(text, out)
  findUrlPasswords(text, out)
  if (text.includes('=') || text.includes(':')) findNamed(text, out)
  if (text.includes('--')) findFlags(text, out)
  return out
}

/** The detector kinds, for tests and the README. */
export const RULE_NAMES: readonly string[] = RULES.map(rule => rule.name)
