// The detector corpus: things to hide and things to keep.
//
// Every key here is fake, built at run time from a fixed generator, and every
// vendor prefix is split in the source (`'sk' + '_live_'`) so no literal in
// this repository looks like a live credential to a secret scanner.

/** A small fixed generator, so every run sees the same "random" bodies. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const HEX = '0123456789abcdef'
const UPPER_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function pick(chars: string, n: number, seed: number): string {
  const next = rng(seed)
  let out = ''
  for (let i = 0; i < n; i++) out += chars[Math.floor(next() * chars.length)]
  // Random keys nearly always mix classes; make sure ours do too.
  if (chars === ALNUM && n >= 6) out = 'aZ7' + out.slice(3)
  return out
}

export const alnum = (n: number, seed: number) => pick(ALNUM, n, seed)
export const hex = (n: number, seed: number) => pick(HEX, n, seed)
const upper = (n: number, seed: number) => pick(UPPER_DIGITS, n, seed)
const letters = (n: number, seed: number) => pick(LETTERS, n, seed)
const digits = (n: number, seed: number) => pick('0123456789', n, seed).replace(/^0/, '1')
const join = (...parts: string[]) => parts.join('')

export type Hide = { label: string; text: string; secret: string }
export type Keep = { label: string; text: string }

const PEM_BODY = [alnum(64, 901), alnum(64, 902), alnum(64, 903), alnum(40, 904) + '=='].join('\n')
const BEGIN = (kind: string) => join('-----BEGIN ', kind, ' PRIVATE', ' KEY-----')
const END = (kind: string) => join('-----END ', kind, ' PRIVATE', ' KEY-----')

const ESCAPED_PEM = join('-----BEGIN', ' PRIVATE', ' KEY-----', '\\n', PEM_BODY.replace(/\n/g, '\\n'), '\\n', '-----END', ' PRIVATE', ' KEY-----')
const GHP = join('gh', 'p_', alnum(36, 1))
const AWS_SECRET = 'kZ8q/Ld3Rw+T2vX5bN7mP4sH1jF6gY0cA2eU8iOp' // 40 characters, with "/" and "+"
const JWT = join('ey', 'J', alnum(30, 70), '.', 'ey', 'J', alnum(60, 71), '.', alnum(43, 72))

const hide = (label: string, secret: string, text = secret): Hide => ({ label, secret, text })

export const HIDE: readonly Hide[] = [
  hide('AWS access key ID', join('AK', 'IA', upper(16, 2)), `aws_access_key_id = ${join('AK', 'IA', upper(16, 2))}`),
  hide('AWS secret key with "/"', AWS_SECRET, `aws_secret_access_key = ${AWS_SECRET}`),
  hide('AWS secret key in an env line', AWS_SECRET, `AWS_SECRET_ACCESS_KEY="${AWS_SECRET}"`),
  hide('GitHub classic token', GHP, `token: ${GHP}`),
  hide('GitHub fine-grained token', join('github', '_pat_', alnum(22, 3), '_', alnum(59, 4))),
  hide('GitHub OAuth token', join('gh', 'o_', alnum(36, 5))),
  hide('Anthropic API key', join('sk-', 'ant-', 'api03-', alnum(80, 6), '-', alnum(6, 7), 'AA')),
  hide('OpenAI project key', join('sk-', 'proj-', alnum(48, 8)), `OPENAI_API_KEY=${join('sk-', 'proj-', alnum(48, 8))}`),
  hide('OpenAI legacy key', join('sk-', alnum(48, 9))),
  hide('Stripe live secret key', join('sk', '_live_', alnum(24, 10))),
  hide('Stripe restricted test key', join('rk', '_test_', alnum(24, 11))),
  hide('Stripe webhook secret', join('wh', 'sec_', alnum(32, 12))),
  hide('Slack bot token', join('xo', 'xb-', digits(11, 13), '-', digits(12, 14), '-', alnum(24, 15))),
  hide('Slack webhook URL', join('https://hooks.', 'slack.com/services/T', upper(8, 16), '/B', upper(8, 17), '/', alnum(24, 18))),
  hide('Google API key', join('AI', 'za', alnum(35, 19))),
  hide('Google OAuth client secret', join('GOC', 'SPX-', alnum(28, 20))),
  hide('Twilio API key', join('S', 'K', hex(32, 21))),
  hide('Twilio auth token by name', hex(32, 22), `TWILIO_AUTH_TOKEN=${hex(32, 22)}`),
  hide('Resend API key', join('re', '_', alnum(8, 23), '_', alnum(24, 24))),
  hide('SendGrid API key', join('S', 'G.', alnum(22, 25), '.', alnum(43, 26))),
  hide('Mailgun API key', join('ke', 'y-', hex(32, 27))),
  hide('npm token', join('np', 'm_', alnum(36, 28))),
  hide('GitLab token', join('gl', 'pat-', alnum(20, 29))),
  hide('Hugging Face token', join('h', 'f_', letters(34, 30))),
  hide('DigitalOcean token', join('do', 'p_v1_', hex(64, 31))),
  hide('Shopify token', join('shp', 'at_', hex(32, 32))),
  hide('Square token', join('sq0', 'atp-', alnum(22, 33))),
  hide('Telegram bot token', join(digits(10, 34), ':', 'AA', alnum(33, 35))),
  hide('Groq API key', join('gs', 'k_', alnum(52, 36))),
  hide('RSA private key block', join(BEGIN('RSA'), '\n', PEM_BODY, '\n', END('RSA'))),
  hide('OpenSSH private key block', join(BEGIN('OPENSSH'), '\n', PEM_BODY, '\n', END('OPENSSH'))),
  hide('Private key escaped inside JSON', ESCAPED_PEM, `{"type": "service_account", "private_key": "${ESCAPED_PEM}\\n"}`),
  hide('JWT', JWT, `session=${JWT}; Path=/`),
  hide('Bearer hex token', hex(40, 40), `Authorization: Bearer ${hex(40, 40)}`),
  hide('Bearer opaque token', join(alnum(24, 41), '.', alnum(16, 42)), `authorization: bearer ${join(alnum(24, 41), '.', alnum(16, 42))}`),
  hide('Basic auth header', btoa('deploy:hunter2-Strong9'), `Authorization: Basic ${btoa('deploy:hunter2-Strong9')}`),
  hide('redis URL with only a password', 'Rd1sPw-9x', 'REDIS_URL=redis://:Rd1sPw-9x@cache.internal:6379/0'),
  hide('postgres URL password', 'pg-Pa55-word', 'postgres://app:pg-Pa55-word@db.internal:5432/app'),
  hide('mongodb+srv URL password, URL-encoded', 'p%40ssW0rd9x', join('mongo', 'db+srv://admin:p%40ssW0rd9x@cluster0.abcde.mongodb.net/test')),
  hide('token in a git remote URL', GHP, `https://x-access-token:${GHP}@github.com/o/r.git`),
  hide('short named password', 'hunter2', 'DB_PASSWORD=hunter2'),
  hide('quoted password in YAML', 'pa55w0rd', 'password: "pa55w0rd"'),
  hide('PGPASSWORD before a command', "s3cr3t!", "PGPASSWORD='s3cr3t!' psql -h db"),
  hide('api_key in JSON', hex(32, 43), `{"api_key": "${hex(32, 43)}"}`),
  hide('client_secret in escaped JSON', alnum(32, 44), `{\\"client_secret\\": \\"${alnum(32, 44)}\\"}`),
  hide('--api-key=value flag', alnum(24, 45), `deploy --api-key=${alnum(24, 45)}`),
  hide('--password value flag', 'S3cretPass9', 'mysqldump --password S3cretPass9 app'),
  hide('X-API-Key header', hex(32, 46), `X-API-Key: ${hex(32, 46)}`),
  hide('Sentry DSN by name', `https://${hex(32, 47)}@o12345.ingest.sentry.io/678`, `SENTRY_DSN=https://${hex(32, 47)}@o12345.ingest.sentry.io/678`),
  hide('Django SECRET_KEY', `django-insecure-${alnum(30, 48)}$(!x`, `SECRET_KEY = "django-insecure-${alnum(30, 48)}$(!x"`),
  hide('access_token in a query string', alnum(30, 49), `GET /api/me?access_token=${alnum(30, 49)}&page=2`),
]

export const KEEP: readonly Keep[] = [
  { label: 'git SHA', text: 'commit 4b825dc642cb6eb9a060e54bf8d69288fbee4904\nAuthor: Pat <pat@company.dev>' },
  { label: 'short git SHA', text: 'HEAD is now at 4b825dc Merge pull request #12 from o/fix' },
  { label: 'UUID by name', text: 'request_id: 123e4567-e89b-12d3-a456-426614174000' },
  { label: 'bare UUID', text: 'created 550e8400-e29b-41d4-a716-446655440000 ok' },
  { label: 'sha512- integrity', text: '"integrity": "sha512-z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg/SpIdNs6c5H0NE8XYXysP+DGNKHfuwvY7kxvUdBeoGlODJ6+SfaPg=="' },
  { label: 'git@host remote', text: 'origin\tgit@github.com:o/r.git (fetch)\norigin\tgit@github.com:o/r.git (push)' },
  { label: 'retina image names', text: '<img src="logo@2x.png" srcset="logo@3x.png 3x">' },
  { label: 'version numbers', text: 'pkg 4.2.1.0 installed; node v20.20.2; python 3.12.4' },
  { label: 'MAC address', text: 'ether 00:1A:2B:3C:4D:5E  inet 192.168.1.4 netmask 0xffffff00' },
  { label: 'lowercase MAC address', text: 'link/ether aa:bb:cc:dd:ee:ff brd ff:ff:ff:ff:ff:ff' },
  { label: 'lorem ipsum', text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt.' },
  { label: 'i18n key', text: '{ key: "home.title", value: "Welcome back" }' },
  { label: 'TypeScript types', text: 'interface Login { password: string; token?: string }' },
  { label: 'template placeholder', text: '"password": "${DB_PASSWORD}"' },
  { label: 'environment variable reference', text: 'curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user' },
  { label: 'numbers and names under secret-ish keys', text: 'TOKEN_TTL=3600\nKEY_PREFIX=app\nmax_tokens: 4096' },
  { label: 'URL without credentials', text: 'see https://docs.company.dev/guide?page=2&sort=asc' },
  { label: 'localhost URL', text: '  Local:   http://localhost:3000/' },
  { label: 'database URL without a password', text: 'postgres://app@localhost:5432/app' },
  { label: 'the word Bearer in prose', text: 'The API uses Bearer authentication for every call.' },
  { label: 'the word Basic in prose', text: 'Basic authentication is disabled on this server.' },
  { label: 'Stripe publishable key (public by design)', text: `const stripe = Stripe('${join('pk', '_live_', alnum(24, 60))}')` },
  { label: 'AWS documentation example key', text: `aws_access_key_id = ${join('AK', 'IA', 'IOSFODNN7', 'EXAMPLE')}` },
  { label: 'SSH public key', text: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGq8vV3mK2xY7pQ9rT4wZ1aB6cD8eF0gH2iJ4kL6mN8o pat@laptop' },
  { label: 'code that reads a key from the environment', text: 'const apiKey = process.env.STRIPE_KEY;\nconst user = { password: hashedPassword, token: sessionToken }' },
  { label: 'docker image digest', text: 'image@sha256:9b2a7d1e3c4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' },
  { label: 'package@version', text: 'added @scope/pkg@1.2.3 and left-pad@1.3.0' },
  { label: 'tokenizer and sort keys', text: 'tokenizer: tokenizer.json\nsort_key: created_at_timestamp' },
  { label: 'base64 image data URI', text: 'src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="' },
  { label: 'CSS colors', text: 'color: #ff00ff; background: #00ff00;' },
  { label: 'documentation of the ticket format', text: 'Tickets look like [secret:NAME#id] in these docs.' },
]
