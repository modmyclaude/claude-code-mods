#!/usr/bin/env node
// The Claude plugin directory's source checks, as far as we have seen them, run
// locally on every mod (or the mods named) before one is submitted:
//   SECRET     a string shaped like a real key in a shipped file     (blocking)
//   INVISIBLE  a zero-width or bidi character in a shipped file       (blocking)
//   H_SHADOW   a function that receives `$` sharing its name with a parameter
//              or variable in the same file (MOD_CAPABILITY_USE_NOT_PLAIN) (blocking)
//   H_NAME     a .tsx file using the name `h` (or `Fragment`) for anything
//              but calling it: JSX compiles to h(...), so the directory's
//              read of the drawing breaks (MOD_CAPABILITY_USE_NOT_PLAIN) (blocking)
//   TOOL_CHECK a tool.check hook that does not `return next(e)` or a
//              literal verdict, so the decision cannot be shown to be
//              left with the person                                   (blocking)
//   PERMISSION a classic.PermissionRequest hook, in hooks or tests, that does
//              not `return next(e)` or a literal deny/ask answer; or a
//              permission hook (that one or tool.check) whose parameter names
//              are declared, assigned or bound again anywhere in the same
//              file (MOD_PERMISSION_ANSWER_UNREAD)                    (blocking;
//              the name as another function's parameter is a hint)
//   CONFIG_SET a `config.set(...)` call, in hooks or tests, whose argument is
//              not one object literal with a fixed-text key and a value, or
//              carries a cast, or a member that is not plain: a literal or a
//              name (`!value` is not; members beyond key and value, and a
//              value that is a name, pass: wardrobe); or one not called on the
//              enclosing hook's or test's first parameter (a test helper's `$`
//              is not followed; a top-level function's is, in hooks)
//              (MOD_CONFIG_SET_UNREAD)                                (blocking)
//   EVENT      a hook on an event the directory's list lacks, `ui.fault`
//              so far (MOD_HOOKS_UNKNOWN_EVENT)                       (blocking)
//   IMPORT     a Client element whose path is not a fixed string, or an
//              import() of a computed path (MOD_IMPORT_DYNAMIC_COMPUTED) (blocking)
//   CLIENT     a Client element with any other attribute not written as a
//              literal or plain names (a template key, a props spread): a
//              hint while the directory's reading of Client is settled (warning)
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

  // A function that receives $ must not share its name with any parameter or variable in the
  // file: the directory cannot then tell which binding the call names (last-look's `hold`).
  const declared = new Map()
  const countDecl = node => {
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) declared.set(node.name.text, (declared.get(node.name.text) ?? 0) + 1)
    node.forEachChild(countDecl)
  }
  countDecl(sf)
  const shadowReported = new Set()
  function checkShadow(callee, node) {
    if (sameFile.has(callee) && (declared.get(callee) ?? 0) > 1 && !shadowReported.has(callee)) {
      shadowReported.add(callee)
      report('H_SHADOW', node, `${callee} receives $ but the name is also a parameter or variable elsewhere in this file; the directory cannot tell which one the call names (rename the others)`)
    }
  }
  function checkUses(fn, dollar, onName, label) {
    const walk = node => {
      if (ts.isIdentifier(node) && (node.text === dollar || node.text === onName) && isReference(node)) {
        const p = node.parent
        let ok
        if (node.text === dollar) {
          ok = (ts.isPropertyAccessExpression(p) && p.expression === node && isCapabilityCall(p))
            || (ts.isCallExpression(p) && p.arguments.includes(node) && ts.isIdentifier(p.expression) && followed(p.expression.text))
          if (ts.isCallExpression(p) && p.arguments.includes(node) && ts.isIdentifier(p.expression)) checkShadow(p.expression.text, p)
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

// ---- hooks and tests alike: permission answers, config.set calls, unknown events, computed paths
const UNKNOWN_EVENTS = new Set(['ui.fault'])
function scanShared(path, out) {
  const text = readFileSync(path, 'utf8')
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const rel = relative(ROOT, path)
  const lineOf = node => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const report = (kind, node, why) => out.push({ kind, at: `${rel}:${lineOf(node)}`, text: why, blocking: true })
  const warn = (kind, node, why) => out.push({ kind, at: `${rel}:${lineOf(node)}`, text: why, blocking: false })
  const isFn = n => ts.isArrowFunction(n) || ts.isFunctionExpression(n)
  const isAnyFn = n => isFn(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
  const permHooks = []
  const isHooksFile = /\/hooks\//.test(rel)
  const rootIsOn = call => { let c = call; while (ts.isCallExpression(c) && ts.isPropertyAccessExpression(c.expression)) c = c.expression.expression; return ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'on' }
  const lastArgOf = fn => ts.isCallExpression(fn.parent) && fn.parent.arguments[fn.parent.arguments.length - 1] === fn ? fn.parent : undefined
  const isHookCallback = fn => { const c = lastArgOf(fn); if (!c) return false; const k = c.expression; return (ts.isIdentifier(k) && k.text === 'on') || (ts.isPropertyAccessExpression(k) && k.name.text === 'catch' && rootIsOn(k.expression)) }
  const isTestCallback = fn => { const c = lastArgOf(fn); return !!c && ts.isIdentifier(c.expression) && (c.expression.text === 'test' || c.expression.text === 'it') }
  const isTopLevelFn = fn => ts.isFunctionDeclaration(fn) ? fn.parent === sf : (ts.isVariableDeclaration(fn.parent) && ts.isVariableDeclarationList(fn.parent.parent) && ts.isVariableStatement(fn.parent.parent.parent) && fn.parent.parent.parent.parent === sf)
  const firstParam = fn => fn.parameters[0] && ts.isIdentifier(fn.parameters[0].name) ? fn.parameters[0].name.text : undefined
  const hasParam = (fn, name) => fn.parameters.some(q => ts.isIdentifier(q.name) && q.name.text === name)
  const fnLabel = fn => ts.isFunctionDeclaration(fn) && fn.name ? fn.name.text : (ts.isVariableDeclaration(fn.parent) && ts.isIdentifier(fn.parent.name) ? fn.parent.name.text : 'a function')
  // The directory reads a config.set only on the hook's first parameter: the enclosing hook's or
  // test's own `$`, or (in a hooks module) a top-level function's parameter it was passed whole into.
  // A test helper's `$` is not followed (the twelve switch tests' flip($, value), halftime 0.1.4).
  function checkReceiver(call, recv) {
    if (!ts.isIdentifier(recv)) { report('CONFIG_SET', call, `config.set must be called on the hook's first parameter, not on ${recv.getText(sf).slice(0, 30)}`); return }
    const name = recv.text
    for (let n = call.parent; n; n = n.parent) {
      if (!isAnyFn(n)) continue
      if (isHookCallback(n) || isTestCallback(n)) {
        if (firstParam(n) === name) return
        report('CONFIG_SET', call, `config.set is called on ${name}, not on the enclosing ${isHookCallback(n) ? 'hook' : 'test'}'s first parameter (${firstParam(n) ?? 'none'})`); return
      }
      if (isHooksFile && isTopLevelFn(n) && hasParam(n, name)) return
      if (hasParam(n, name)) { report('CONFIG_SET', call, `config.set is called on ${name} inside ${fnLabel(n)}, which the directory does not follow; write the call in the ${isHooksFile ? 'hook' : 'test'} itself, on its first parameter`); return }
    }
    report('CONFIG_SET', call, `config.set is called on ${name} outside any hook or test; the directory reads it only on the hook's first parameter`)
  }
  const isLiteralValue = n => isLiteralText(n) || ts.isNumericLiteral(n) || (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)) || n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword
  // plain, as the directory reads a member: a literal, a name, or an object of plain members (`!value`, a call or a spread is not)
  const isPlain = n => isLiteralValue(n) || ts.isIdentifier(n) || (ts.isObjectLiteralExpression(n) && n.properties.every(q => ts.isShorthandPropertyAssignment(q) || (ts.isPropertyAssignment(q) && isPlain(q.initializer))))
  const isLiteralText = n => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
  const walk = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      // on('event', ..., hook)
      if (ts.isIdentifier(callee) && callee.text === 'on' && node.arguments[0] && isLiteralText(node.arguments[0])) {
        const ev = node.arguments[0].text
        if (UNKNOWN_EVENTS.has(ev)) report('EVENT', node, `on('${ev}') is not on the directory's event list; Claude Code at that list's version refuses to load the mod`)
        const fn = node.arguments[node.arguments.length - 1]
        if (ev === 'classic.PermissionRequest' && fn && isFn(fn)) checkAnswer(fn, 'classic.PermissionRequest')
        if ((ev === 'classic.PermissionRequest' || ev === 'tool.check') && fn && isFn(fn)) permHooks.push({ fn, ev })
      }
      // X.config.set(arg)
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'set' && ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === 'config') {
        checkReceiver(node, callee.expression.expression)
        const a = node.arguments[0]
        if (!a || !ts.isObjectLiteralExpression(a)) report('CONFIG_SET', node, `config.set takes one object written in the call (${a ? a.getText(sf).slice(0, 50) : 'nothing'}); a cast or a variable breaks the directory's read`)
        else {
          const short = n => n.getText(sf).replace(/\s+/g, ' ').slice(0, 40)
          const key = a.properties.find(q => ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'key')
          const value = a.properties.find(q => (ts.isPropertyAssignment(q) || ts.isShorthandPropertyAssignment(q)) && ts.isIdentifier(q.name) && q.name.text === 'value')
          if (!key || !isLiteralText(key.initializer)) report('CONFIG_SET', node, `config.set needs a fixed-text key member (${key ? short(key.initializer) : 'none'})`)
          if (!value) report('CONFIG_SET', node, 'config.set needs a value member written in the call')
          for (const q of a.properties) {
            if (ts.isSpreadAssignment(q)) { report('CONFIG_SET', q, `config.set's object has a spread member (${short(q)}); every member must be written in the call`); continue }
            if (ts.isShorthandPropertyAssignment(q)) continue
            if (!ts.isPropertyAssignment(q) || !ts.isIdentifier(q.name)) { report('CONFIG_SET', q, `config.set's object has a member that is not a plain name (${short(q)})`); continue }
            if (!isPlain(q.initializer)) report('CONFIG_SET', q, `config.set's ${q.name.text} is not plain (${short(q.initializer)}): write a literal or a name, not an expression`)
          }
        }
      }
      // import(expr)
      if (callee.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && !isLiteralText(node.arguments[0])) report('IMPORT', node, `import() of a computed path (${node.arguments[0].getText(sf).slice(0, 40)}); write a fixed string or a static import`)
    }
    // <Client path={...}> with anything but a fixed string
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
      const tag = node.tagName.getText(sf)
      if (tag === 'Client' || tag.endsWith('.Client')) {
        const pathAttr = node.attributes.properties.find(a => ts.isJsxAttribute(a) && ts.isIdentifier(a.name) && (a.name.text === 'module' || a.name.text === 'path'))
        const init = pathAttr && pathAttr.initializer
        const fixed = init && (ts.isStringLiteral(init) || (ts.isJsxExpression(init) && init.expression && isLiteralText(init.expression)))
        if (!fixed) report('IMPORT', node, `a Client element whose module is not a fixed string (${init ? init.getText(sf).slice(0, 40) : 'no module'})`)
        // Until the directory's reader is understood: every other attribute of a Client written as a
        // literal too (a template key or a props spread may read as the computed path it refuses).
        for (const a of node.attributes.properties) {
          if (ts.isJsxSpreadAttribute(a)) { out.push({ kind: 'CLIENT', at: `${rel}:${lineOf(a)}`, text: 'a Client element with a spread attribute; the directory may read it as a computed path', blocking: false }); continue }
          if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || a.name.text === 'module') continue
          const v = a.initializer
          const literal = !v || ts.isStringLiteral(v) || (ts.isJsxExpression(v) && v.expression && isPlain(v.expression))
          if (!literal) out.push({ kind: 'CLIENT', at: `${rel}:${lineOf(a)}`, text: `a Client element's ${a.name.text} is not written as a literal or plain names (${v ? v.getText(sf).replace(/\s+/g, ' ').slice(0, 50) : ''}); the directory may read it as a computed path`, blocking: false })
        }
      }
    }
    node.forEachChild(walk)
  }
  function checkAnswer(fn, ev) {
    const e = fn.parameters[1] && ts.isIdentifier(fn.parameters[1].name) ? fn.parameters[1].name.text : undefined
    const next = fn.parameters[2] && ts.isIdentifier(fn.parameters[2].name) ? fn.parameters[2].name.text : undefined
    for (const prm of fn.parameters) if (!ts.isIdentifier(prm.name)) report('PERMISSION', prm, `a ${ev} hook's parameters must be plain names`)
    const returns = []
    const inner = n => { if (isFn(n) && n !== fn) return; if (ts.isReturnStatement(n)) returns.push(n); if (ts.isIdentifier(n) && n.text === 'arguments') report('PERMISSION', n, `a ${ev} hook must not use arguments`); n.forEachChild(inner) }
    inner(fn.body)
    if (!ts.isBlock(fn.body)) returns.push({ expression: fn.body, getStart: () => fn.body.getStart(sf) })
    if (returns.length === 0) report('PERMISSION', fn, `a ${ev} hook that returns nothing ends the check without deciding it; return next(${e ?? 'e'}) or a literal deny or ask`)
    for (const r of returns) {
      const x = r.expression
      const passes = x && ts.isCallExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === next && x.arguments.length === 1 && ts.isIdentifier(x.arguments[0]) && x.arguments[0].text === e
      // a literal answer: { decision: 'deny' | 'ask' } (tool.check's shape) or the classic hook's
      // { decision: { behavior: 'deny' | 'ask', ... } }, written in the return
      const isVerdictLiteral = q => {
        if (!ts.isPropertyAssignment(q) || !ts.isIdentifier(q.name)) return false
        if (q.name.text === 'deny') return isLiteralText(q.initializer)
        if (q.name.text !== 'decision') return false
        if (isLiteralText(q.initializer)) return ['deny', 'ask'].includes(q.initializer.text)
        if (ts.isObjectLiteralExpression(q.initializer)) return q.initializer.properties.some(b => ts.isPropertyAssignment(b) && ts.isIdentifier(b.name) && b.name.text === 'behavior' && isLiteralText(b.initializer) && ['deny', 'ask'].includes(b.initializer.text))
        return false
      }
      const verdict = x && ts.isObjectLiteralExpression(x) && x.properties.some(isVerdictLiteral)
      if (!passes && !verdict) report('PERMISSION', r, `a ${ev} hook must return next(${e ?? 'e'}) or a literal deny or ask; this returns ${x ? x.getText(sf).slice(0, 50) : 'nothing'}`)
    }
  }
  walk(sf)
  // A permission hook's parameter names are its own in the whole file: a variable, an assignment,
  // a function or an import under one of them, anywhere, and the directory can no longer read the
  // hook's answer (halftime 0.1.3's `const next = await update(...)`, far from the hook).
  if (permHooks.length) {
    const hookFns = new Set()
    const collect = n => {
      if (ts.isCallExpression(n)) {
        const isOn = ts.isIdentifier(n.expression) && n.expression.text === 'on'
        const isCatch = ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'catch' && rootIsOn(n.expression.expression)
        if (isOn || isCatch) { const f = n.arguments[n.arguments.length - 1]; if (f && isFn(f)) hookFns.add(f) }
      }
      n.forEachChild(collect)
    }
    collect(sf)
    const names = new Set()
    for (const ph of permHooks) for (const prm of ph.fn.parameters) if (ts.isIdentifier(prm.name)) names.add(prm.name.text)
    const inHook = n => { for (let c = n; c; c = c.parent) if (permHooks.some(ph => ph.fn === c)) return true; return false }
    const where = n => inHook(n) ? 'in the hook' : 'elsewhere in this file'
    const bound = n => {
      const name = n.name && ts.isIdentifier(n.name) ? n.name.text : undefined
      if (name && names.has(name)) {
        if (ts.isVariableDeclaration(n) || ts.isBindingElement(n)) report('PERMISSION', n, `${name} is spelled like a permission hook's parameter and is declared again ${where(n)}; the directory then cannot read the hook's answer (rename it)`)
        else if (ts.isFunctionDeclaration(n) || ts.isImportSpecifier(n) || ts.isClassDeclaration(n)) report('PERMISSION', n, `${name} is spelled like a permission hook's parameter and is bound again ${where(n)} (rename it)`)
        else if (ts.isParameter(n) && !hookFns.has(n.parent)) {
          if (inHook(n)) report('PERMISSION', n, `${name} is spelled like the hook's parameter and is bound again as a parameter inside the hook (rename it)`)
          else if (!name.startsWith('$')) warn('PERMISSION', n, `${name} is spelled like a permission hook's parameter and is a parameter of another function in this file; the directory's wording names a variable elsewhere, so this is a hint (rename it to be safe)`)
        }
      }
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(n.left) && names.has(n.left.text)) report('PERMISSION', n, `${n.left.text} is spelled like a permission hook's parameter and is assigned ${where(n)} (rename it)`)
      n.forEachChild(bound)
    }
    bound(sf)
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
      if (!isCallee) { // a type member, a property, a parameter: the directory counts them all
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
        out.push({ kind: 'H_NAME', at: `${rel}:${line}`, text: `the name ${node.text} is used as ${p.getText(sf).replace(/\s+/g, ' ').slice(0, 50)}; in a .tsx file it is the JSX factory and nothing else (rename it)`, blocking: true })
      }
    }
    node.forEachChild(walk)
  }
  walk(sf)
}

// A mod by name under mods/, or by path (a probe copy anywhere).
const names = process.argv.slice(2)
const isMod = dir => { try { return statSync(join(dir, '.claude-plugin', 'plugin.json')).isFile() } catch { return false } }
const mods = (names.length ? names.map(n => n.replace(/\/$/, '')) : readdirSync(join(ROOT, 'mods')))
  .map(n => isMod(n) ? { name: n, dir: n } : { name: n.replace(/^mods\//, ''), dir: join(ROOT, 'mods', n.replace(/^mods\//, '')) })
  .filter(m => isMod(m.dir))
let blocking = 0, warnings = 0
for (const { name: mod, dir } of mods) {
  const out = []
  for (const path of shipped(dir)) {
    scanText(path, out)
    if (/\/hooks\/[^/]+\.tsx?$/.test(path)) scanModule(path, out)
    if (path.endsWith('.tsx')) scanJsxNames(path, out)
    if (/\/(?:hooks|tests)\/[^/]+\.tsx?$/.test(path)) scanShared(path, out)
  }
  const b = out.filter(f => f.blocking).length, w = out.length - b
  blocking += b; warnings += w
  console.log(`${b ? '!!' : 'ok'}  ${mod}: ${b} blocking, ${w} warning${w === 1 ? '' : 's'}`)
  for (const f of out) console.log(`    ${f.blocking ? 'BLOCK' : 'warn '} ${f.kind.padEnd(10)} ${f.at}  ${f.text}`)
}
console.log(`${mods.length} mods: ${blocking} blocking, ${warnings} warnings`)
process.exit(blocking ? 1 : 0)
