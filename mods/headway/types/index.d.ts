// Headway's state contract. `done` is the public "plan done" signal other
// mods may read or react to; `run` is Headway's own working state and may
// change shape between versions.

/** Where the plan came from: a TodoWrite list, the Task tools, or an approved plan-mode plan alone. */
export type HeadwaySource = 'todo' | 'task' | 'outline'

export type HeadwayStepStatus = 'pending' | 'active' | 'done'

export type HeadwayStep = {
  /** Identity across rewrites: `task:<id>` for a task, a minted `t<n>` for a todo item. */
  key: string
  title: string
  /** Index into the plan's `stages`. */
  stage: number
  status: HeadwayStepStatus
  /** Working time the step took, in ms; absent when it was already done when Headway first saw it. */
  ms?: number
}

/** This project's pace from earlier sessions: the median step time and how many steps it rests on. */
export type HeadwayPrior = { medianMs: number; count: number }

export type HeadwayPlan = {
  id: number
  source: HeadwaySource
  /** Stage names; a single '' for a flat list. */
  stages: string[]
  steps: HeadwayStep[]
  /** Plan-clock ms (working time only) when the plan started. */
  startedAt: number
  /** Plan-clock ms of the last step completion, or the start. */
  lastMarkAt: number
  /** The last completions that share one span (several steps marked done together). */
  batch?: { start: number; keys: string[] }
  /** True once the plan was seen with a step still to do. */
  wasOpen: boolean
  nextKey: number
  projectKey?: string
  prior?: HeadwayPrior
  /** The total the first honest estimate predicted, in ms. */
  firstEstimateMs?: number
  /** A replan's flash: steps added and removed, shown until `until` (wall ms). */
  revised?: { added: number; removed: number; until: number }
  /** Wall ms when the last step finished; the green flash runs from here. */
  finishedAt?: number
  totalMs?: number
  receipt?: string
}

/** An approved plan-mode plan, reduced to stage names and step titles. */
export type HeadwayOutline = { stages: string[]; steps: { title: string; stage: number }[] }

export type HeadwayRun = {
  plan: HeadwayPlan | null
  outline: HeadwayOutline | null
  /** The plan clock: working ms banked, and the wall ms the current working span began (null while idle). */
  clock: { activeMs: number; since: number | null }
  /** True while the main loop's turn runs. */
  turn: boolean
  /** Ids of the subagents running now. */
  agents: string[]
  /** Ids that ended before their start was seen (kept briefly so the count never goes wrong). */
  ended: string[]
  /** This session's finished step times, in ms. */
  durations: number[]
  hidden: boolean
  /** The last plan id handed out. */
  seq: number
  /** Claude's turns begun since it last updated its plan; at QUIET_TURNS an unfinished plan leaves. */
  quiet: number
}

/**
 * Written once each time a plan finishes. Counts and durations only, never titles.
 * Read it with `$.state.get({ plugin: 'headway', key: 'done' })` (a render hook
 * that reads it redraws when it changes), or hook `state.set` with the matcher
 * `{ plugin: 'headway', key: 'done' }` to react the moment it is written.
 */
export type HeadwayDone = {
  /** Which plan of this session finished; grows by one or more per plan. */
  seq: number
  /** Wall-clock ms when it finished. */
  at: number
  /** Working time from the plan's start to its last step, in ms. */
  totalMs: number
  steps: number
  /** Working ms per stage, in stage order (one entry for a flat list). */
  stageMs: number[]
  /** The total the first estimate predicted, or null when none was shown. */
  estimateMs: number | null
}

declare module 'claude-code' {
  interface PluginState {
    headway: { run: HeadwayRun; done: HeadwayDone | null }
  }
}
