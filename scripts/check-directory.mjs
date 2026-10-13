#!/usr/bin/env node
// The Claude plugin directory's source checks, as far as we have seen them, run
// locally on every mod (or the mods named) before one is submitted:
//   SECRET     a string shaped like a real key in a shipped file     (blocking)
//   INVISIBLE  a zero-width or bidi character in a shipped file       (blocking)
//   H_NAME     a .tsx file using the name `h` (or `Fragment`) for anything
//              but calling it: JSX compiles to h(...), so the directory's
//              read of the drawing breaks (MOD_CAPABILITY_USE_NOT_PLAIN) (blocking)
//   TOOL_CHECK a tool.check hook that does not `return next(e)` or a
//              literal verdict, so the decision cannot be shown to be
//              left with the person                                   (blocking)
//   RUN        a download-and-run command in a shipped file           (warning)
//   FOLLOW     `$` or `on` used in a way a static read may not follow:
//              not as `$.noun.method(...)`, not as `on("event", hook)`,
//              not passed whole to a function declared at the top of
//              the same file or imported from the kit                  (warning:
//              an approximation; it clears ant-farm and thermostat, which
//              the directory passed, but does not yet reproduce the
//              directory's three findings on last-look, so treat it as a
//              hint until it is calibrated against those lines)
// Usage: node scripts/check-directory.mjs [mod ...]   (every mod when none is named)
// Exit 1 on any blocking finding. Approximations, read from the directory's
// own fix texts; a pass here is not a pass there, a finding here is one there.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

// The repo's typescript is the native build (7.x), which ships no compiler API;
// the parser comes from a classic typescript 5 fetched once into a cache folder.
const require = createRequire(import.meta.url)
function loadTypescript() {
  try { const t = require('typescript'); if (typeof t.createSourceFile === 'function') return t } catch {}
  const dir = join(homedir(), '.cache', 'claude-mods', 'ts5')
  const pkg = join(dir, 'node_modules', 'typescript')
  try { return require(pkg) } catch {}
  console.error(`check-directory: fetching typescript@5 once into ${dir} (the repo's 7.x build has no parser API)`)
  execFileSync('npm', ['install', '--prefix', dir, '--no-audit', '--no-fund', '--no-save', 'typescript@5'], { stdio: 'inherit' })
  return require(pkg)
}
const ts = loadTypescript()

const ROOT = new URL('..', import.meta.url).pathname
const SECRET = [
  /AKIA[0-9A-Z]{16}/, /ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /sk-[A-Za-z0-9_-]{20,}/, /sk_(?:live|test)_[A-Za-z0-9]{10,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/, /AIza[0-9A-Za-z_-]{35}/, /glpat-[A-Za-z0-9_-]{20}/, /wJalrXUtnFEMI\/K7MDENG/,
]
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u2028\u2029]/
const RUN = /\b(?:curl|wget)\b[^\n]*(?:https?:|\|\s*(?:ba)?sh\b)|\|\s*(?:ba)?sh\b/
const TEXT = /\.(?:ts|tsx|js|mjs|json|md|txt|css)$/

function* shipped(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name === 'node_modules' || name === 'types' && dir.endsWith('.claude-plugin')) continue
    if (statSync(path).isDirectory()) yield* shipped(path)
    else if (TEXT.test(name)) yield path
  }
}

function scanText(path, out) {
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const at = `${relative(ROOT, path)}:${i + 1}`
    for (const re of SECRET) if (re.test(line)) out.push({ kind: 'SECRET', at, text: line.trim().slice(0, 90), blocking: true })
    if (INVISIBLE.test(line)) out.push({ kind: 'INVISIBLE', at, text: [...line].filter(c => INVISIBLE.test(c)).map(c => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' '), blocking: true })
    if (RUN.test(line)) out.push({ kind: 'RUN', at, text: line.trim().slice(0, 90), blocking: false })
  })
}

// ---- the hooks module: tool.check returns, and where $ and on go
function scanModule(path, out) {
  const text = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = relative(ROOT, path)
  const lineOf = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  // Where $ may go: a call on it ($.noun.method(...)), or whole into a function declared in this
  // file or imported from the kit; a function imported from another file of the mod is not followed.
  const sameFile = new Set(), kitImport = new Set()
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) sameFile.add(st.name.text)
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) sameFile.add(d.name.text)
    if (ts.isImportDeclaration(st) && st.importClause && ts.isStringLiteral(st.moduleSpecifier) && /^claude-code(\/|$)/.test(st.moduleSpecifier.text)) {
      const c = st.importClause
      if (c.name) kitImport.add(c.name.text)
      if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) kitImport.add(el.name.text)
    }
  }
  const followed = name => sameFile.has(name) || kitImport.has(name)
  const isFn = n => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
  const paramName = (fn, i) => fn.parameters[i] && ts.isIdentifier(fn.parameters[i].name) ? fn.parameters[i].name.text : undefined
  const report = (kind, node, why, blocking = true) => out.push({ kind, at: `${rel}:${lineOf(node)}`, text: why, blocking })

  function checkUses(fn, dollar, onName, label) {
    const walk = node => {
      if (ts.isIdentifier(node) && (node.text === dollar || node.text === onName) && isReference(node)) {
        const p = node.parent
        let ok
        if (node.text === dollar) {
          ok = (ts.isPropertyAccessExpression(p) && p.expression === node && isCapabilityCall(p))
            || (ts.isCallExpression(p) && p.arguments.includes(node) && ts.isIdentifier(p.expression) && followed(p.expression.text))
        } else {
          ok = (ts.isCallExpression(p) && p.expression === node)
            || (ts.isCallExpression(p) && p.arguments.includes(node) && ts.isIdentifier(p.expression) && followed(p.expression.text))
        }
        if (!ok) {
          const where = ts.isCallExpression(p) && p.arguments.includes(node) ? `passed to ${p.expression.getText(sf).slice(0, 40)}, which is not declared in this file` : `used as ${p.getText(sf).slice(0, 50)}`
          report('FOLLOW', node, `${node.text} ${where} (${label}): the directory follows ${node.text} only as ${node.text === dollar ? '$.noun.method(...)' : 'on("event", hook)'} or whole into a function declared at the top of this file`, false)
        }
        return
      }
      node.forEachChild(walk)
    }
    walk(fn.body ?? fn)
  }
  // a standalone reference, not a declaration name and not a property name (c.on, x.$)
  function isReference(id) {
    const p = id.parent
    if ((ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name === id) return !ts.isShorthandPropertyAssignment(p) ? false : true
    if (ts.isPropertyAccessExpression(p) && p.name === id) return false
    return true
  }
  function isCapabilityCall(pa) {
    let n = pa
    while (ts.isPropertyAccessExpression(n.parent)) n = n.parent
    return ts.isCallExpression(n.parent) && n.parent.expression === n
  }

  // hooks: on(...) calls and their .catch(...) chains, inside register
  const hooks = []
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isOn = ts.isIdentifier(callee) && callee.text === 'on'
      const isCatch = ts.isPropertyAccessExpression(callee) && callee.name.text === 'catch' && ts.isCallExpression(callee.expression) && eventOf(callee.expression) !== undefined && ts.isIdentifier(rootCall(callee.expression).expression) && rootCall(callee.expression).expression.text === 'on'
      if (isOn || isCatch) {
        const fn = node.arguments[node.arguments.length - 1]
        const ev = isOn && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : (isCatch ? eventOf(callee.expression) : undefined)
        if (fn && isFn(fn)) hooks.push({ fn, ev, chained: isCatch })
      }
    }
    node.forEachChild(visit)
  }
  const rootCall = call => { let c = call; while (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression)) c = c.expression.expression; return c }
  const eventOf = call => { let c = call; while (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression)) c = c.expression.expression; return ts.isCallExpression(c) && c.arguments[0] && ts.isStringLiteral(c.arguments[0]) ? c.arguments[0].text : undefined }
  visit(sf)
  for (const h of hooks) {
    const dollar = paramName(h.fn, 0), e = paramName(h.fn, 1), next = paramName(h.fn, 2)
    if (dollar) checkUses(h.fn, dollar, 'on', `hook ${h.ev ?? '?'}`)
    if (h.ev === 'tool.check') checkToolCheck(h.fn, e, next)
  }
  // top-level functions that take $ (or on) whole
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.body) {
      const names = st.parameters.map((p, i) => paramName(st, i))
      const dollar = names.find(n => typeof n === 'string' && n.startsWith('$')), onName = names.find(n => n === 'on')
      if (dollar || onName) checkUses(st, dollar ?? '\u0000', onName ?? '\u0000', `function ${st.name?.text}`)
    }
  }
  function checkToolCheck(fn, e, next) {
    const returns = []
    const walk = (n, nested) => { if (isFn(n) && n !== fn) return; if (ts.isReturnStatement(n)) returns.push(n); n.forEachChild(c => walk(c, nested)) }
    walk(fn.body, false)
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) returns.push({ expression: fn.body, fake: true, getStart: () => fn.body.getStart(sf) })
    for (const r of returns) {
      const x = r.expression
      const passes = x && ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === next && x.arguments.length === 1 && ts.isIdentifier(x.arguments[0]) && x.arguments[0].text === e
      const verdict = x && ts.isObjectLiteralExpression(x) && x.properties.some(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'decision' && ts.isStringLiteral(p.initializer) && ['deny', 'ask'].includes(p.initializer.text))
      if (!passes && !verdict) report('TOOL_CHECK', r.fake ? fn : r, `a tool.check hook must return next(${e}) or a literal { decision: 'deny' | 'ask' }; this returns ${x ? x.getText(sf).slice(0, 60) : 'nothing'}`)
    }
  }
}

// ---- .tsx files: `h` and `Fragment` are the JSX factory's names and nothing else's
function scanJsxNames(path, out) {
  const text = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = relative(ROOT, path)
  const walk = node => {
    if (ts.isIdentifier(node) && (node.text === 'h' || node.text === 'Fragment')) {
      const p = node.parent
      const isCallee = ts.isCallExpression(p) && p.expression === node
      const isTypeSide = ts.isPropertySignature(p) || ts.isTypeReferenceNode(p) || ts.isPropertyAccessExpression(p) && p.name === node || ts.isPropertyAssignment(p) && p.name === node && !ts.isShorthandPropertyAssignment(p) || ts.isJsxAttribute(p) || ts.isQualifiedName(p)
      if (!isCallee && !isTypeSide) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        out.push({ kind: 'H_NAME', at: `${rel}:${line}`, text: `the name ${node.text} is used as ${p.getText(sf).replace(/\s+/g, ' ').slice(0, 50)}; in a .tsx file it is the JSX factory and nothing else (rename it)`, blocking: true })
      }
    }
    node.forEachChild(walk)
  }
  walk(sf)
}

const names = process.argv.slice(2)
const mods = (names.length ? names.map(n => n.replace(/^mods\//, '').replace(/\/$/, '')) : readdirSync(join(ROOT, 'mods'))).filter(m => { try { return statSync(join(ROOT, 'mods', m, '.claude-plugin', 'plugin.json')).isFile() } catch { return false } })
let blocking = 0, warnings = 0
for (const mod of mods) {
  const out = []
  for (const path of shipped(join(ROOT, 'mods', mod))) {
    scanText(path, out)
    if (/\/hooks\/[^/]+\.tsx?$/.test(path)) scanModule(path, out)
    if (path.endsWith('.tsx')) scanJsxNames(path, out)
  }
  const b = out.filter(f => f.blocking).length, w = out.length - b
  blocking += b; warnings += w
  console.log(`${b ? '!!' : 'ok'}  ${mod}: ${b} blocking, ${w} warning${w === 1 ? '' : 's'}`)
  for (const f of out) console.log(`    ${f.blocking ? 'BLOCK' : 'warn '} ${f.kind.padEnd(10)} ${f.at}  ${f.text}`)
}
console.log(`${mods.length} mods: ${blocking} blocking, ${warnings} warnings`)
process.exit(blocking ? 1 : 0)
