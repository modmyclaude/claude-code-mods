// The pure part of mulligan: from what the classifier found in a command, what
// a snapshot must hold so /mulligan can put the project back; and the words.
//
// A positive list of shapes, never "everything not matched is safe": the
// classifier names the commands that destroy files (rm, find -delete, xargs
// rm, git clean, git reset --hard, git checkout or restore over changes,
// git worktree remove, a redirect over a file). Pushes and branch deletions
// touch no file here and take no snapshot.

import type { CdStep, Finding, Word } from './classify'
import { join, normalize, within } from './paths'

/** What one snapshot holds. */
export type Scope = {
  /** Every file under the project (git: tracked changes and untracked files). */
  isTree: boolean
  /** git: the tracked files' state, through `git stash create` (HEAD when nothing changed). */
  isTracked: boolean
  /** git: untracked files that are not ignored. */
  isUntracked: boolean
  /** Paths under the project the command acts on, absolute, none inside another. */
  paths: string[]
}

export type Plan = {
  scope: Scope
  /** Targets outside the project, which no snapshot covers. */
  outside: string[]
  /** What the snapshot leaves out, in words (ignored files under git clean -x). */
  notes: string[]
}

export const EMPTY_SCOPE: Scope = { isTree: false, isTracked: false, isUntracked: false, paths: [] }

/** True when the scope holds nothing to save. */
export function isEmpty(scope: Scope): boolean {
  return !scope.isTree && !scope.isTracked && !scope.isUntracked && scope.paths.length === 0
}

/** Where a finding runs: the shell's directory through its `cd`s, or undefined when a `cd` is unknown ahead. */
export function whereItRuns(cwd: string, steps: readonly CdStep[]): string | undefined {
  let dir = cwd
  for (const step of steps) {
    if (!step.dir.known) return undefined
    dir = join(dir, step.dir.text)
  }
  return dir
}

/**
 * The part of a path written before its first pattern: `build/*` is `build`, `**` is nothing.
 * Undefined when the word holds an expansion nobody can know ahead.
 */
export function staticPart(word: Word): string | undefined {
  if (!word.known) return undefined
  if (!word.glob) return word.text
  const segments: string[] = []
  for (const segment of word.text.split('/')) {
    if (/[*?[{]/.test(segment)) break
    segments.push(segment)
  }
  return segments.join('/')
}

/**
 * What to save before `findings` run from the shell's directory `cwd`, in a project at `root`.
 * Null when nothing in the command touches files (no finding, or only pushes and branch deletes).
 */
export function planFor(findings: readonly Finding[], cwd: string, root: string, isGit: boolean): Plan | null {
  const scope: Scope = { ...EMPTY_SCOPE, paths: [] }
  const outside: string[] = []
  const notes: string[] = []
  let isFiles = false
  const add = (dir: string | undefined, target: Word) => {
    const part = dir === undefined ? undefined : staticPart(target)
    if (dir === undefined || part === undefined || part === '') {
      scope.isTree = true // where or what is only known when it runs: save the whole project
      return
    }
    const path = join(dir, part)
    if (!within(root, path)) outside.push(path)
    else if (path === normalize(root)) scope.isTree = true
    else scope.paths.push(path)
  }
  for (const f of findings) {
    const dir = whereItRuns(cwd, f.cd)
    switch (f.kind) {
      case 'rm':
      case 'find-delete':
      case 'redirect':
        isFiles = true
        if (f.targets.length === 0) scope.isTree = true
        for (const target of f.targets) add(dir, target)
        break
      case 'xargs-rm':
        isFiles = true
        scope.isTree = true // it deletes whatever the command before it prints
        break
      case 'git-worktree-remove':
        isFiles = true
        for (const target of f.git?.sub === 'worktree' ? f.git.paths : []) add(dir, target)
        break
      case 'git-clean':
        isFiles = true
        if (dir !== undefined && !within(root, dir)) outside.push(dir) // git -C another repository
        else if (isGit) scope.isUntracked = true
        else scope.isTree = true
        if (f.git?.sub === 'clean' && f.git.flags.some(flag => /x/i.test(flag.replace(/^--?/, '')))) {
          notes.push('ignored files (git clean -x) are not saved')
        }
        break
      case 'git-reset-hard':
      case 'git-discard':
        isFiles = true
        if (dir !== undefined && !within(root, dir)) outside.push(dir)
        else if (isGit) scope.isTracked = true
        else scope.isTree = true
        break
      case 'git-push-force':
      case 'git-branch-delete':
        break // no file in the project changes
    }
  }
  if (!isFiles) return null
  if (scope.isTree) {
    scope.paths = []
    if (isGit) {
      scope.isTracked = true
      scope.isUntracked = true
    }
  }
  scope.paths = outermost(scope.paths)
  return { scope, outside: [...new Set(outside)], notes }
}

/** The whole project, for the person's own `always` pattern. */
export function treePlan(isGit: boolean): Plan {
  return { scope: { isTree: true, isTracked: isGit, isUntracked: isGit, paths: [] }, outside: [], notes: [] }
}

/** Paths with every one inside another dropped: `build` covers `build/x`. */
export function outermost(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths)].sort()
  return sorted.filter(path => !sorted.some(other => other !== path && within(other, path)))
}

/** A path as the person reads it: relative to the project, else as it is. */
export function shown(path: string, root: string): string {
  if (path === root) return '.'
  return within(root, path) ? path.slice(root === '/' ? 1 : root.length + 1) : path
}

/** What a snapshot holds, in a few words: "build, dist", "tracked changes and untracked files", "the project". */
export function scopeWords(scope: Scope, root: string): string {
  if (scope.isTree) return 'the project'
  const parts: string[] = []
  if (scope.isTracked) parts.push('tracked changes')
  if (scope.isUntracked) parts.push('untracked files')
  if (scope.paths.length > 0) {
    const names = scope.paths.map(path => shown(path, root))
    parts.push(names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`)
  }
  return parts.join(' and ')
}

/** One line for a drawing: whitespace runs as one space, at most `max` characters. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

/** Control characters and escape sequences out of anything drawn (commands and paths are Claude's). */
export function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '�')
}

/** 12345678 bytes as "12 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`
  return `${Math.round(bytes / 100_000) / 10} MB`
}

/** "3m ago", "2h ago", for the list. */
export function agoWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

/** FNV-1a over the project root: a short key for its folder that does not spell the path. */
export function projectKey(root: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let g = 0x01000193
  for (let i = root.length - 1; i >= 0; i--) {
    g ^= root.charCodeAt(i)
    g = Math.imul(g, 0x811c9dc5) >>> 0
  }
  return h.toString(16).padStart(8, '0') + g.toString(16).padStart(8, '0')
}

/** The note Claude reads after a restore: its view of the files is stale. */
export function restoreNote(command: string, n: number): string {
  return (
    `The person restored files in this project to how they were before the command \`${oneLine(command, 200)}\` ` +
    `(mulligan snapshot ${n}). Files may differ from what you last read: re-read any file before editing it.`
  )
}
