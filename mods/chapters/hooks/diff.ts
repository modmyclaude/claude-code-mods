// Diffs for chapters: a unified diff read into files and hunks, a diff made
// from Claude's own edits where there is no git, new files as whole additions,
// cleaning for drawing, and the split that keeps what the model is sent capped.
// What is sent is redacted, and a secrets file goes by its name alone.

import { redact } from './redact'

export type Hunk = { header: string; newStart: number; newLines: number; text: string }
/** `isSecret`: a secrets file by its name; its hunks are never kept, sent or drawn. */
export type FileDiff = { path: string; hunks: Hunk[]; isBinary: boolean; isSecret: boolean }

/** Files whose contents are never sent or drawn, by name: the same list as pop-quiz's. */
const SECRET_FILES: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|ppk|asc|gpg)$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /^credentials(\..*)?$/i,
  /^\.(npmrc|netrc|pgpass|pypirc|git-credentials|htpasswd)$/i,
  /\.tfvars(\.json)?$/i,
  /^secrets?\./i,
]

export function isSecretFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? path
  return SECRET_FILES.some(re => re.test(name))
}

/** Escape sequences and every control character but tab and newline: what a Code element may hold. */
export function cleanDiff(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '�')
}

/** The path a `diff --git a/x b/y` header names (the new side), unquoting git's C-style quotes. */
function pathOf(header: string): string {
  const quoted = /^diff --git "?a\/(.*?)"? "?b\/(.*?)"?$/.exec(header)
  return quoted ? quoted[2]! : header.replace(/^diff --git /, '')
}

/** A unified diff (git's) read into files and hunks; binary files kept by name. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let file: FileDiff | null = null
  let hunk: { header: string; newStart: number; newLines: number; lines: string[] } | null = null
  const closeHunk = () => {
    if (file && hunk) file.hunks.push({ header: hunk.header, newStart: hunk.newStart, newLines: hunk.newLines, text: [hunk.header, ...hunk.lines].join('\n') })
    hunk = null
  }
  for (const line of cleanDiff(text).split('\n')) {
    if (line.startsWith('diff --git ')) {
      closeHunk()
      const path = pathOf(line)
      file = { path, hunks: [], isBinary: false, isSecret: isSecretFile(path) }
      files.push(file)
      continue
    }
    if (!file || file.isSecret) continue // a secrets file's lines are never kept
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      file.isBinary = true
      continue
    }
    const at = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (at) {
      closeHunk()
      hunk = { header: line, newStart: Number(at[1]), newLines: at[2] === undefined ? 1 : Number(at[2]), lines: [] }
      continue
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) hunk.lines.push(line)
  }
  closeHunk()
  return files
}

/** A new file, whole, as a diff: every line an addition. */
export function newFileDiff(path: string, content: string): string {
  const lines = content.replace(/\n$/, '').split('\n')
  return [`diff --git a/${path} b/${path}`, 'new file', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n')
}

/** One of Claude's own edits as a diff; where in the file is not known, so it starts at line 1. */
export function editDiff(path: string, before: string, after: string): string {
  const old = before === '' ? [] : before.split('\n')
  const now = after.split('\n')
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${old.length} +1,${now.length} @@`,
    ...old.map(l => `-${l}`),
    ...now.map(l => `+${l}`),
  ].join('\n')
}

/** A file's diff as text again, for the model: redacted, and a secrets file by name only. */
export function fileText(file: FileDiff): string {
  if (file.isSecret) return `diff --git a/${file.path} b/${file.path}\n(a secrets file changed: its contents are not sent)`
  if (file.isBinary) return `diff --git a/${file.path} b/${file.path}\n(binary file changed)`
  return redact([`diff --git a/${file.path} b/${file.path}`, ...file.hunks.map(h => h.text)].join('\n'))
}

/**
 * The diff in at most two batches of at most `cap` characters, whole files
 * first; what does not fit is cut, and `left` counts the files not sent.
 */
export function batches(files: readonly FileDiff[], cap: number): { texts: string[]; left: number } {
  const texts: string[] = []
  let current = ''
  let left = 0
  for (const file of files) {
    const text = fileText(file)
    if (current !== '' && current.length + text.length + 1 > cap) {
      texts.push(current)
      current = ''
    }
    if (texts.length === 2) {
      left++
      continue
    }
    if (text.length > cap) {
      // One file bigger than a whole batch: its head, marked as cut.
      current = `${current}${current ? '\n' : ''}${text.slice(0, cap - 60)}\n[... the rest of ${file.path} was cut]`
      texts.push(current.slice(0, cap))
      current = ''
      continue
    }
    current = current === '' ? text : `${current}\n${text}`
  }
  if (current !== '' && texts.length < 2) texts.push(current)
  else if (current !== '') left++
  return { texts, left }
}

/** The hunks of `path` that touch new-side lines `from` to `to` (all of them when no lines are named). */
export function hunksFor(files: readonly FileDiff[], path: string, lines?: [number, number]): Hunk[] {
  const file = files.find(f => f.path === path) ?? files.find(f => f.path.endsWith(`/${path}`) || path.endsWith(`/${f.path}`))
  if (!file) return []
  if (!lines) return file.hunks
  const [from, to] = lines
  const near = file.hunks.filter(h => h.newStart <= to && h.newStart + Math.max(1, h.newLines) - 1 >= from)
  return near.length > 0 ? near : file.hunks
}

/** Changed lines (additions and removals) across the files. */
export function changedLines(files: readonly FileDiff[]): number {
  let n = 0
  for (const f of files) for (const h of f.hunks) for (const line of h.text.split('\n').slice(1)) if (line.startsWith('+') || line.startsWith('-')) n++
  return n
}
