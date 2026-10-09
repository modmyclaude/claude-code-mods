// Headway's model: one pure reducer over its session state, plus the views
// the band and the pane draw. The hooks module feeds it events and carries
// out the effects it returns; nothing here touches the engine.
//
// Times: `wall` is the wall clock. The plan clock counts working time only
// (while Claude's turn or a subagent runs), so a lunch break never makes a
// step look slow. A step's time is the span since the previous completion,
// shared evenly when several finish together.

import type { HeadwayDone, HeadwayOutline, HeadwayPlan, HeadwayPrior, HeadwayRun, HeadwayStep, HeadwayStepStatus } from '../types'
import { pairKeys, pairTitles, type Pairing } from './match'
import { stageList, stageOfTitle } from './outline'
import { MIN_FINISHED, estimate, formatDuration, formatLeft, isRunningLong, receiptText, timeLeft } from './pace'

export const TICK_MS = 1000
/** How long the bar stays green before the receipt. */
export const FLASH_MS = 3000
/** How long "plan revised" shows. */
export const REVISE_MS = 4000
/** Completions this close together (plan-clock ms) share one span. */
export const COALESCE_MS = 2000
export const MAX_SESSION_DURATIONS = 200
export const MAX_AGENT_IDS = 50
/** The bar is one cell per step up to this many, then scaled. */
export const BAR_CELLS = 10

export const EMPTY_RUN: HeadwayRun = {
  plan: null,
  outline: null,
  clock: { activeMs: 0, since: null },
  turn: false,
  agents: [],
  ended: [],
  durations: [],
  hidden: false,
  seq: 0,
}

export type Item = { title: string; status: HeadwayStepStatus; key?: string }

export type HeadwayEvent =
  | { kind: 'turn'; isRunning: boolean }
  | { kind: 'agent-start'; id: string }
  | { kind: 'agent-end'; id: string }
  | { kind: 'todos'; items: Item[] }
  | { kind: 'task-create'; id: string; title: string }
  | { kind: 'task-update'; id: string; isMain: boolean; title?: string; status?: HeadwayStepStatus | 'deleted' }
  | { kind: 'task-list'; items: Item[] }
  | { kind: 'outline'; outline: HeadwayOutline }
  | { kind: 'hidden'; hidden: boolean | 'toggle' }
  | { kind: 'attach'; planId: number; projectKey: string; prior?: HeadwayPrior }
  | { kind: 'tick' }
  | { kind: 'clear' }

export type Effect =
  | { kind: 'receipt'; text: string }
  | { kind: 'finished'; done: HeadwayDone; durations: number[]; projectKey?: string }
  | { kind: 'new-plan'; planId: number }

export function isWorking(run: HeadwayRun): boolean {
  return run.turn || run.agents.length > 0
}

/** Working ms on the plan clock at wall time `wall`. */
export function planNow(clock: HeadwayRun['clock'], wall: number): number {
  return clock.activeMs + (clock.since === null ? 0 : Math.max(0, wall - clock.since))
}

function syncClock(clock: HeadwayRun['clock'], working: boolean, wall: number): HeadwayRun['clock'] {
  if (working && clock.since === null) return { activeMs: clock.activeMs, since: wall }
  if (!working && clock.since !== null) return { activeMs: clock.activeMs + Math.max(0, wall - clock.since), since: null }
  return clock
}

/** Whether the one timer should run: a plan is drawn and either work goes on or a flash is pending. */
export function wantsTimer(run: HeadwayRun, wall: number): boolean {
  const plan = run.plan
  if (!plan || run.hidden || !plan.wasOpen) return false
  if (plan.finishedAt !== undefined) return true
  if (plan.revised && wall < plan.revised.until) return true
  return plan.source !== 'outline' && isWorking(run)
}

type Ctx = { run: HeadwayRun; effects: Effect[]; wall: number; now: number }

function patch(ctx: Ctx, fields: Partial<HeadwayRun>): void {
  ctx.run = { ...ctx.run, ...fields }
}

// Every plan change goes through here, so a finished plan's receipt is
// toasted exactly once, whatever takes it off the screen.
function setPlan(ctx: Ctx, plan: HeadwayPlan | null): void {
  const out = ctx.run.plan
  if (out?.receipt !== undefined && out.id !== plan?.id) ctx.effects.push({ kind: 'receipt', text: out.receipt })
  patch(ctx, { plan })
}

function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const { [key]: _dropped, ...rest } = value
  return rest
}

/** A plan tool ran in the main loop, so Claude's turn is running (covers a reload mid-turn). */
function mainLoop(ctx: Ctx): void {
  if (!ctx.run.turn) patch(ctx, { turn: true })
}

export function reduce(run: HeadwayRun, event: HeadwayEvent, wall: number): { run: HeadwayRun; effects: Effect[] } {
  const ctx: Ctx = { run, effects: [], wall, now: planNow(run.clock, wall) }
  switch (event.kind) {
    case 'turn':
      if (run.turn !== event.isRunning) patch(ctx, { turn: event.isRunning })
      // An approved plan with no todo or task list has nothing left to show once its turn ends.
      if (!event.isRunning && ctx.run.plan?.source === 'outline') setPlan(ctx, null)
      break
    case 'agent-start':
      agentStart(ctx, event.id)
      break
    case 'agent-end':
      agentEnd(ctx, event.id)
      break
    case 'todos':
      mainLoop(ctx)
      applyList(ctx, event.items, 'todo')
      break
    case 'task-list':
      mainLoop(ctx)
      applyList(ctx, event.items, 'task')
      break
    case 'task-create':
      mainLoop(ctx)
      taskCreate(ctx, event.id, event.title)
      break
    case 'task-update':
      if (event.isMain) mainLoop(ctx)
      taskUpdate(ctx, event)
      break
    case 'outline':
      mainLoop(ctx)
      applyOutline(ctx, event.outline)
      break
    case 'hidden': {
      const hidden = event.hidden === 'toggle' ? !run.hidden : event.hidden
      if (hidden !== run.hidden) patch(ctx, { hidden })
      // Hidden mid-flash: skip the flash, the receipt still comes.
      if (hidden && ctx.run.plan?.finishedAt !== undefined) setPlan(ctx, null)
      break
    }
    case 'attach': {
      const plan = ctx.run.plan
      if (plan?.id === event.planId) setPlan(ctx, { ...plan, projectKey: event.projectKey, ...(event.prior ? { prior: event.prior } : {}) })
      break
    }
    case 'tick':
      tick(ctx)
      break
    case 'clear':
      setPlan(ctx, null)
      patch(ctx, { ...EMPTY_RUN, hidden: run.hidden, seq: run.seq })
      break
  }
  const clock = syncClock(ctx.run.clock, isWorking(ctx.run), wall)
  if (clock !== ctx.run.clock) patch(ctx, { clock })
  return { run: ctx.run, effects: ctx.effects }
}

function agentStart(ctx: Ctx, id: string): void {
  const { agents, ended } = ctx.run
  if (ended.includes(id)) patch(ctx, { ended: ended.filter(other => other !== id) })
  else if (!agents.includes(id)) patch(ctx, { agents: [...agents, id].slice(-MAX_AGENT_IDS) })
}

function agentEnd(ctx: Ctx, id: string): void {
  const { agents, ended } = ctx.run
  if (agents.includes(id)) patch(ctx, { agents: agents.filter(other => other !== id) })
  else if (!ended.includes(id)) patch(ctx, { ended: [...ended, id].slice(-MAX_AGENT_IDS) })
}

function tick(ctx: Ctx): void {
  const plan = ctx.run.plan
  if (!plan) return
  if (plan.finishedAt !== undefined) {
    if (ctx.wall >= plan.finishedAt + FLASH_MS) setPlan(ctx, null)
    return
  }
  if (plan.revised && ctx.wall >= plan.revised.until) setPlan(ctx, without(plan, 'revised'))
}

function itemsOf(plan: HeadwayPlan): Item[] {
  return plan.steps.map(step => ({ key: step.key, title: step.title, status: step.status }))
}

function applyList(ctx: Ctx, items: readonly Item[], source: 'todo' | 'task'): void {
  const plan = ctx.run.plan
  if (items.length === 0) {
    // Claude emptied its list: an unfinished plan of that list is over.
    if (plan && plan.finishedAt === undefined && plan.source === source) setPlan(ctx, null)
    return
  }
  if (plan && plan.finishedAt === undefined && plan.source === source) {
    const pairing =
      source === 'task'
        ? pairKeys(plan.steps.map(step => step.key), items.map(item => item.key ?? ''))
        : pairTitles(plan.steps.map(step => step.title), items.map(item => item.title))
    // Nothing in common means a new plan, not a revision.
    if (pairing.matched > 0) {
      revise(ctx, plan, items, pairing)
      return
    }
  }
  startPlan(ctx, items, source)
}

function startPlan(ctx: Ctx, items: readonly Item[], source: 'todo' | 'task'): void {
  // A list that follows an approved plan keeps the plan's start and project.
  const carry = ctx.run.plan?.source === 'outline' ? ctx.run.plan : undefined
  const id = ctx.run.seq + 1
  const { stages, stageOf } = stageList(items.map(item => item.title), ctx.run.outline)
  let nextKey = 1
  const steps: HeadwayStep[] = items.map((item, index) => ({
    key: item.key ?? `t${nextKey++}`,
    title: item.title,
    stage: stageOf[index] ?? 0,
    status: item.status,
  }))
  const startedAt = carry ? carry.startedAt : ctx.now
  const plan: HeadwayPlan = {
    id,
    source,
    stages,
    steps,
    startedAt,
    lastMarkAt: startedAt,
    wasOpen: steps.some(step => step.status !== 'done'),
    nextKey,
    ...(carry?.projectKey === undefined ? {} : { projectKey: carry.projectKey }),
    ...(carry?.prior === undefined ? {} : { prior: carry.prior }),
  }
  patch(ctx, { seq: id })
  setPlan(ctx, plan)
  if (plan.projectKey === undefined) ctx.effects.push({ kind: 'new-plan', planId: id })
}

function revise(ctx: Ctx, old: HeadwayPlan, items: readonly Item[], pairing: Pairing): void {
  const outline = ctx.run.outline
  const isStaged = outline !== null && old.stages.length > 1
  let nextKey = old.nextKey
  let previousStage = 0
  const wasDone = new Set<string>()

  const steps: HeadwayStep[] = items.map((item, j) => {
    const before = old.steps[pairing.oldOf[j] ?? -1]
    if (!before) {
      const stage = (isStaged && outline ? stageOfTitle(item.title, outline) : null) ?? previousStage
      previousStage = stage
      return { key: item.key ?? `t${nextKey++}`, title: item.title, stage, status: item.status }
    }
    previousStage = before.stage
    // A renamed step that was done stays done; an exact title (or task id) trusts the new status.
    const status = before.status === 'done' && !pairing.isExact[j] ? 'done' : item.status
    const step: HeadwayStep = { key: before.key, title: item.title, stage: before.stage, status }
    if (before.status === 'done' && status === 'done') {
      wasDone.add(before.key)
      if (before.ms !== undefined) step.ms = before.ms
    }
    return step
  })

  const newlyDone = steps.filter(step => step.status === 'done' && !wasDone.has(step.key))
  let { lastMarkAt, batch } = old
  let durations = ctx.run.durations
  if (newlyDone.length > 0) {
    // Steps marked done a moment apart (parallel calls) share the span with the batch before them.
    const joins = batch !== undefined && ctx.now - old.lastMarkAt <= COALESCE_MS
    const prior = joins && batch ? batch.keys.filter(key => steps.some(step => step.key === key && step.status === 'done')) : []
    const start = joins && batch ? batch.start : old.lastMarkAt
    const keys = [...prior, ...newlyDone.map(step => step.key)]
    const each = Math.max(0, Math.round((ctx.now - start) / keys.length))
    for (const step of steps) if (keys.includes(step.key)) step.ms = each
    const kept = joins && batch ? durations.slice(0, Math.max(0, durations.length - batch.keys.length)) : durations
    durations = [...kept, ...keys.map(() => each)].slice(-MAX_SESSION_DURATIONS)
    lastMarkAt = ctx.now
    batch = { start, keys }
  }

  let plan: HeadwayPlan = {
    ...without(old, 'batch'),
    steps,
    lastMarkAt,
    nextKey,
    wasOpen: old.wasOpen || steps.some(step => step.status !== 'done'),
    ...(batch === undefined ? {} : { batch }),
  }
  // Flash the change instead of letting the bar jump without a reason, once work has begun.
  const hasBegun = old.steps.some(step => step.status !== 'pending')
  if ((pairing.added > 0 || pairing.removed > 0) && hasBegun) {
    plan = { ...plan, revised: { added: pairing.added, removed: pairing.removed, until: ctx.wall + REVISE_MS } }
  }
  patch(ctx, { durations })
  setPlan(ctx, withFirstEstimate(plan, durations, ctx.now))
  finishIfDone(ctx)
}

/** Records the total the first honest estimate predicts, for the receipt. */
export function withFirstEstimate(plan: HeadwayPlan, durations: readonly number[], now: number): HeadwayPlan {
  if (plan.firstEstimateMs !== undefined) return plan
  const timed = plan.steps.filter(step => step.ms !== undefined).length
  const remaining = plan.steps.filter(step => step.status !== 'done').length
  if (timed < MIN_FINISHED || remaining === 0) return plan
  const guess = estimate(durations, plan.prior)
  if (!guess || !guess.isSteady) return plan
  return { ...plan, firstEstimateMs: Math.round(now - plan.startedAt + guess.perStepMs * remaining) }
}

function finishIfDone(ctx: Ctx): void {
  const plan = ctx.run.plan
  if (!plan || plan.finishedAt !== undefined || !plan.wasOpen || plan.steps.length === 0) return
  if (plan.steps.some(step => step.status !== 'done')) return
  const totalMs = Math.max(0, Math.round(ctx.now - plan.startedAt))
  const stageMs = plan.stages.map((_, index) =>
    plan.steps.filter(step => step.stage === index).reduce((sum, step) => sum + (step.ms ?? 0), 0),
  )
  const used = plan.stages
    .map((name, index) => ({ name: name === '' ? `Stage ${index + 1}` : name, ms: stageMs[index] ?? 0, index }))
    .filter(stage => plan.steps.some(step => step.stage === stage.index))
  const receipt = receiptText(totalMs, plan.firstEstimateMs, used, plan.steps.length)
  ctx.effects.push({
    kind: 'finished',
    done: { seq: plan.id, at: ctx.wall, totalMs, steps: plan.steps.length, stageMs, estimateMs: plan.firstEstimateMs ?? null },
    durations: plan.steps.flatMap(step => (step.ms === undefined ? [] : [step.ms])),
    ...(plan.projectKey === undefined ? {} : { projectKey: plan.projectKey }),
  })
  setPlan(ctx, { ...without(plan, 'revised'), finishedAt: ctx.wall, totalMs, receipt })
  // The approved plan has been worked through; the next list starts flat.
  patch(ctx, { outline: null })
  if (ctx.run.hidden) setPlan(ctx, null)
}

function taskCreate(ctx: Ctx, id: string, title: string): void {
  const plan = ctx.run.plan
  const item: Item = { key: `task:${id}`, title, status: 'pending' }
  if (!plan || plan.source !== 'task' || plan.finishedAt !== undefined) {
    startPlan(ctx, [item], 'task')
    return
  }
  if (plan.steps.some(step => step.key === item.key)) return
  applyList(ctx, [...itemsOf(plan), item], 'task')
}

function taskUpdate(ctx: Ctx, event: Extract<HeadwayEvent, { kind: 'task-update' }>): void {
  const plan = ctx.run.plan
  if (!plan || plan.source !== 'task' || plan.finishedAt !== undefined) return
  const key = `task:${event.id}`
  if (!plan.steps.some(step => step.key === key)) return
  const items = itemsOf(plan).flatMap(item => {
    if (item.key !== key) return [item]
    if (event.status === 'deleted') return []
    return [{ key, title: event.title ?? item.title, status: event.status ?? item.status }]
  })
  if (items.length === 0) setPlan(ctx, null)
  else applyList(ctx, items, 'task')
}

function applyOutline(ctx: Ctx, outline: HeadwayOutline): void {
  patch(ctx, { outline })
  const plan = ctx.run.plan
  if (plan && plan.finishedAt === undefined && plan.source !== 'outline') {
    // A list is already running: give its steps the approved plan's stages.
    const { stages, stageOf } = stageList(plan.steps.map(step => step.title), outline)
    setPlan(ctx, { ...plan, stages, steps: plan.steps.map((step, index) => ({ ...step, stage: stageOf[index] ?? 0 })) })
    return
  }
  // No list yet: show the approved plan until a list appears or its turn ends.
  const id = ctx.run.seq + 1
  const startedAt = plan?.source === 'outline' ? plan.startedAt : ctx.now
  const steps: HeadwayStep[] = outline.steps.map((step, index) => ({ key: `o${index + 1}`, title: step.title, stage: step.stage, status: 'pending' }))
  patch(ctx, { seq: id })
  setPlan(ctx, { id, source: 'outline', stages: outline.stages, steps, startedAt, lastMarkAt: startedAt, wasOpen: true, nextKey: steps.length + 1 })
  ctx.effects.push({ kind: 'new-plan', planId: id })
}

// Views: what the band and the pane draw, as plain data.

export type Tone = 'plain' | 'dim' | 'long' | 'done' | 'note'
export type Part = { key: string; text: string; tone: Tone }

export type BandView =
  | { kind: 'summary'; text: string; agents: number }
  | {
      kind: 'progress'
      stage?: string
      title: string
      done: number
      total: number
      tone: 'normal' | 'long' | 'done'
      right?: string
      note?: string
      agents: number
    }

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function revisedText(revised: { added: number; removed: number }): string {
  const changes = [revised.added > 0 ? `+${revised.added}` : '', revised.removed > 0 ? `−${revised.removed}` : ''].filter(Boolean)
  return `plan revised ${changes.join(' ')}`
}

function currentStep(plan: HeadwayPlan): HeadwayStep | undefined {
  return plan.steps.find(step => step.status === 'active') ?? plan.steps.find(step => step.status !== 'done')
}

type Pace = { elapsed: number; right?: string; isLong: boolean }

function paceOf(run: HeadwayRun, plan: HeadwayPlan, wall: number): Pace {
  const elapsed = Math.max(0, planNow(run.clock, wall) - plan.lastMarkAt)
  const timed = plan.steps.filter(step => step.ms !== undefined).length
  const guess = timed >= MIN_FINISHED ? estimate(run.durations, plan.prior) : null
  if (!guess) return { elapsed, isLong: false }
  if (isRunningLong(elapsed, guess.perStepMs)) return { elapsed, isLong: true, right: `${formatDuration(elapsed)} on this step` }
  if (!guess.isSteady) return { elapsed, isLong: false, right: 'estimating...' }
  const remaining = plan.steps.filter(step => step.status !== 'done').length
  const left = timeLeft(guess.perStepMs, remaining, elapsed)
  return { elapsed, isLong: false, right: left < 60_000 ? '<1m left' : `~${formatLeft(left)} left` }
}

/** The band's content, or null when there is nothing to show. */
export function bandView(run: HeadwayRun, wall: number): BandView | null {
  const plan = run.plan
  if (!plan || !plan.wasOpen || plan.steps.length === 0) return null
  const agents = run.agents.length
  if (plan.source === 'outline') {
    const stages = plan.stages.length > 1 ? `${plural(plan.stages.length, 'stage')}, ` : ''
    return { kind: 'summary', text: `Plan approved · ${stages}${plural(plan.steps.length, 'step')}`, agents }
  }
  const total = plan.steps.length
  const done = plan.steps.filter(step => step.status === 'done').length
  if (plan.finishedAt !== undefined) {
    return { kind: 'progress', title: 'Plan done', done: total, total, tone: 'done', right: `in ${formatDuration(plan.totalMs ?? 0)}`, agents }
  }
  const current = currentStep(plan)
  const pace = paceOf(run, plan, wall)
  const stage = plan.stages.length > 1 && current ? plan.stages[current.stage] : undefined
  return {
    kind: 'progress',
    ...(stage ? { stage } : {}),
    title: current?.title ?? '',
    done,
    total,
    tone: pace.isLong ? 'long' : 'normal',
    ...(pace.right === undefined ? {} : { right: pace.right }),
    ...(plan.revised && wall < plan.revised.until ? { note: revisedText(plan.revised) } : {}),
    agents,
  }
}

function width(text: string): number {
  return [...text].length
}

/** Cuts text to `room` cells, ending with an ellipsis when cut. */
export function fit(text: string, room: number): string {
  const chars = [...text]
  if (chars.length <= room) return text
  if (room <= 1) return chars.slice(0, Math.max(0, room)).join('')
  return chars.slice(0, room - 1).join('') + '…'
}

export function barCells(done: number, total: number): { on: number; off: number } {
  const cells = Math.min(Math.max(total, 1), BAR_CELLS)
  const on = total <= BAR_CELLS ? done : Math.round((done / total) * BAR_CELLS)
  return { on: Math.min(cells, Math.max(0, on)), off: cells - Math.min(cells, Math.max(0, on)) }
}

const MIN_TITLE = 12

/**
 * The band as one line of parts within `columns`. When room is short it
 * drops, in order, the stage, the extras (revision note, agents chip), then
 * the bar, and cuts the title last.
 */
export function layoutBand(view: BandView, columns: number): Part[] {
  const chip = view.agents > 0 ? plural(view.agents, 'agent') : ''
  if (view.kind === 'summary') {
    const tail = chip === '' ? '' : ` · ${chip}`
    const parts: Part[] = [{ key: 'summary', text: fit(view.text, Math.max(1, columns - width(tail))), tone: 'dim' }]
    if (tail !== '' && columns - width(tail) >= MIN_TITLE) parts.push({ key: 'agents', text: tail, tone: 'dim' })
    return parts
  }
  const accent: Tone = view.tone === 'done' ? 'done' : view.tone === 'long' ? 'long' : 'plain'
  const { on, off } = barCells(view.done, view.total)
  const count = ` (${view.done}/${view.total})`
  const right = view.right === undefined ? '' : ` ${view.right}`
  const note = view.note === undefined ? '' : ` · ${view.note}`
  const agents = chip === '' ? '' : ` · ${chip}`
  let stage = view.stage === undefined ? '' : `${view.stage} · `
  let extras = note + agents
  let bar = ` ${'▰'.repeat(on)}${'▱'.repeat(off)}`
  const room = () => columns - width(stage) - width(count) - width(bar) - width(right) - width(extras)
  if (room() < MIN_TITLE) stage = ''
  if (room() < MIN_TITLE) extras = ''
  if (room() < MIN_TITLE) bar = ''
  const title = fit(view.title, Math.max(1, room()))
  const parts: Part[] = []
  if (stage !== '') parts.push({ key: 'stage', text: stage, tone: 'dim' })
  parts.push({ key: 'title', text: title, tone: accent })
  parts.push({ key: 'count', text: count, tone: 'dim' })
  if (bar !== '') {
    parts.push({ key: 'bar-done', text: ` ${'▰'.repeat(on)}`, tone: accent })
    if (off > 0) parts.push({ key: 'bar-left', text: '▱'.repeat(off), tone: 'dim' })
  }
  if (right !== '') parts.push({ key: 'right', text: right, tone: accent === 'plain' ? 'dim' : accent })
  if (extras !== '') {
    if (note !== '') parts.push({ key: 'note', text: note, tone: 'note' })
    if (agents !== '') parts.push({ key: 'agents', text: agents, tone: 'dim' })
  }
  return parts
}

export type Row = { key: string; text: string; tone: Tone }

/** The pane's rows: every step with its status and time, by stage. */
export function paneRows(run: HeadwayRun, last: HeadwayDone | null, wall: number): Row[] {
  const plan = run.plan
  if (!plan || !plan.wasOpen || plan.steps.length === 0) {
    const rows: Row[] = [
      { key: 'empty', text: 'No plan right now. Headway follows Claude’s todo or task list and plans approved in plan mode.', tone: 'dim' },
    ]
    if (last) rows.push({ key: 'last', text: `Last plan: ${plural(last.steps, 'step')}, done in ${formatDuration(last.totalMs)}.`, tone: 'dim' })
    return rows
  }
  const rows: Row[] = []
  const done = plan.steps.filter(step => step.status === 'done').length
  // An approved plan with no list has no step under way yet.
  const current = plan.finishedAt === undefined && plan.source !== 'outline' ? currentStep(plan) : undefined
  const pace = paceOf(run, plan, wall)
  if (plan.source === 'outline') {
    rows.push({ key: 'summary', text: 'Plan approved. Progress shows once Claude starts a todo or task list.', tone: 'dim' })
  } else if (plan.finishedAt !== undefined) {
    rows.push({ key: 'summary', text: plan.receipt ?? `Plan done in ${formatDuration(plan.totalMs ?? 0)}.`, tone: 'done' })
  } else {
    const so = formatDuration(Math.max(0, planNow(run.clock, wall) - plan.startedAt))
    rows.push({ key: 'summary', text: `${done}/${plan.steps.length} steps done · ${so} so far${pace.right ? ` · ${pace.right}` : ''}`, tone: pace.isLong ? 'long' : 'plain' })
  }
  plan.stages.forEach((name, index) => {
    const steps = plan.steps.filter(step => step.stage === index)
    if (steps.length === 0) return
    if (plan.stages.length > 1) rows.push({ key: `stage-${index}`, text: name === '' ? `Stage ${index + 1}` : name, tone: 'plain' })
    const indent = plan.stages.length > 1 ? '  ' : ''
    for (const step of steps) {
      const isCurrent = step === current
      const mark = step.status === 'done' ? '[x]' : isCurrent ? '[>]' : '[ ]'
      const time =
        step.status === 'done'
          ? step.ms === undefined
            ? ' · done before Headway saw it'
            : ` · ${formatDuration(step.ms)}`
          : isCurrent
            ? ` · running ${formatDuration(pace.elapsed)}`
            : ''
      const tone: Tone = step.status === 'done' ? 'dim' : isCurrent && pace.isLong ? 'long' : 'plain'
      rows.push({ key: `step-${step.key}`, text: `${indent}${mark} ${step.title}${time}`, tone })
    }
  })
  return rows
}
