// Per-project pace history, kept in the mod's own store: step durations and
// plan counts only, never titles. Projects are keyed by a hash of their root.

import type { HeadwayPrior } from '../types'
import { median } from './pace'

export const HISTORY_KEY = 'history'
/** Durations kept per project (the most recent). */
export const MAX_DURATIONS = 40
/** Projects kept (the most recently updated). */
export const MAX_PROJECTS = 30
/** History speaks for a project only once it holds this many step times. */
export const MIN_PRIOR = 3
const MAX_STEP_MS = 24 * 60 * 60 * 1000

export type ProjectPace = { d: number[]; plans: number; at: number }
export type PaceFile = { v: 1; projects: Record<string, ProjectPace> }

/** FNV-1a over the root twice (two seeds): a stable 16-hex-digit key that does not spell the path. */
export function projectKey(root: string): string {
  const hash = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < root.length; i += 1) {
      h ^= root.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
  }
  return hash(0x811c9dc5) + hash(0x01234567)
}

function isDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < MAX_STEP_MS
}

/** Reads what the store holds, dropping anything malformed. */
export function readPace(raw: unknown): PaceFile {
  const file: PaceFile = { v: 1, projects: {} }
  if (typeof raw !== 'object' || raw === null) return file
  const projects = (raw as { projects?: unknown }).projects
  if (typeof projects !== 'object' || projects === null) return file
  for (const [key, value] of Object.entries(projects as Record<string, unknown>)) {
    if (!/^[0-9a-f]{16}$/.test(key) || typeof value !== 'object' || value === null) continue
    const { d, plans, at } = value as { d?: unknown; plans?: unknown; at?: unknown }
    if (!Array.isArray(d)) continue
    file.projects[key] = {
      d: d.filter(isDuration).slice(-MAX_DURATIONS),
      plans: typeof plans === 'number' && Number.isFinite(plans) && plans >= 0 ? Math.floor(plans) : 0,
      at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
    }
  }
  return file
}

/** Adds one finished plan's step durations to its project, within the caps. */
export function recordPlan(file: PaceFile, key: string, durations: readonly number[], wall: number): PaceFile {
  const before = file.projects[key] ?? { d: [], plans: 0, at: 0 }
  const projects = {
    ...file.projects,
    [key]: { d: [...before.d, ...durations.filter(isDuration).map(Math.round)].slice(-MAX_DURATIONS), plans: before.plans + 1, at: wall },
  }
  const kept = Object.entries(projects)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MAX_PROJECTS)
  return { v: 1, projects: Object.fromEntries(kept) }
}

/** The project's pace from earlier sessions, once it has enough to say. */
export function priorFor(file: PaceFile, key: string): HeadwayPrior | undefined {
  const durations = file.projects[key]?.d ?? []
  return durations.length >= MIN_PRIOR ? { medianMs: median(durations), count: durations.length } : undefined
}
