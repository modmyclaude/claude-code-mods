// hatchling: a pixel pet in the band above the prompt. It hatches after 25
// tool calls, reacts to what Claude does, and evolves as it gains XP.
//
// Where things live:
//   $.store 'pet'        the saved pet (survives restarts, shared by sessions)
//   $.state pet/anim/... the session's copy the band draws from
//   module variables     only the two timers, which a reload drops anyway

import { atom, read, update } from 'claude-code'
import type { BoxProps, ElementConstructor, EngineInterface, Register, TextProps, Timer } from 'claude-code'

import type { HatchlingAnim, HatchlingMood, HatchlingPet, HatchlingStage } from '../types'
import { drawFrame, rasterCells, speciesArt, toCells, toRuns } from './art'
import type { Cell, View } from './art'
import {
  ADULT_XP,
  applyToolCall,
  applyTurn,
  cardText,
  cleanName,
  cryptoU32,
  detectTestPass,
  HATCH_AT,
  nameOf,
  normalizePet,
  parseCard,
  progressOf,
  rarityOf,
  stageOf,
  statText,
  TEEN_XP,
  toolLabel,
} from './pet'
import type { Change } from './pet'
import { RARITY_COLOR } from './sprites'

const STORE_KEY = 'pet'
const FRAME_MS = 300
const SLEEP_MS = 5 * 60_000
/** A turn that never reported its end stops the working loop after 10 min. */
const STALL_TICKS = Math.round((10 * 60_000) / FRAME_MS)

/** Ticks each mood plays before settling (sleep: the doze-off, then still). */
const DURATION: Readonly<Record<HatchlingMood, number>> = {
  idle: 0, happy: 4, sweat: 9, cheer: 12, sleep: 6, hatch: 10, evolve: 12,
}
/** A busier mood is not cut short by a lesser one. */
const PRIORITY: Readonly<Record<HatchlingMood, number>> = {
  idle: 0, sleep: 0, happy: 1, sweat: 2, cheer: 3, evolve: 4, hatch: 5,
}

const IDLE: HatchlingAnim = { mood: 'idle', tick: 0, left: 0, line: '' }
const EGG_ACCENT = '#e9dcb8'

const petState = atom({ plugin: 'hatchling', key: 'pet' } as const, null)
const animState = atom({ plugin: 'hatchling', key: 'anim' } as const, IDLE)
const workingState = atom({ plugin: 'hatchling', key: 'working' } as const, false)

type $ = EngineInterface
type Tags = { Box: ElementConstructor<BoxProps>; Text: ElementConstructor<TextProps> }

const HELP = [
  '/pet             stat card',
  '/pet name <name> rename your pet (or the egg, before it hatches)',
  '/pet hide        hide the band   /pet show  bring it back',
  '/pet card        a small text card to copy and share',
].join('\n')

// The only module state: the two timers and what schedules them. A reload
// drops them with the old environment, which is what we want.
let ticker: Timer | undefined
let sleeper: Timer | undefined
let isInteractive = true
let quietTicks = 0
let tickerSeq = 0
let sleepSeq = 0
let queue: Promise<unknown> = Promise.resolve()

// ------------------------------------------------------------ saving

/**
 * Applies one change to the saved pet. Re-reads the store first every time
 * (another open session may have written since), and runs one at a time so
 * parallel tool calls never lose an update.
 */
function commit($: $, change: (pet: HatchlingPet, now: number) => Change): Promise<Change> {
  async function job() {
    const now = await $.clock.now()
    const result = change(normalizePet(await $.store.get(STORE_KEY), now), now)
    await $.store.set(STORE_KEY, result.pet)
    await update($, petState, () => result.pet)
    return result
  }
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

function same(pet: HatchlingPet): Change {
  return { pet, isHatched: false }
}

// ------------------------------------------------------------ timers

function stopTimers(): void {
  tickerSeq += 1
  sleepSeq += 1
  ticker?.cancel()
  sleeper?.cancel()
  ticker = undefined
  sleeper = undefined
}

/** The frame timer runs only while a mood plays or Claude is working. */
async function syncTicker($: $) {
  const seq = ++tickerSeq
  const pet = await read($, petState)
  const anim = await read($, animState)
  const isWorking = await read($, workingState)
  if (seq !== tickerSeq) return // a newer call decides
  const isOn =
    isInteractive && pet !== null && !pet.hidden && (anim.left > 0 || (isWorking && anim.mood !== 'sleep'))
  if (isOn && ticker === undefined) ticker = $.clock.every(FRAME_MS, () => void step($))
  if (!isOn && ticker !== undefined) {
    ticker.cancel()
    ticker = undefined
  }
}

async function step($: $) {
  try {
    quietTicks += 1
    if (quietTicks > STALL_TICKS) await update($, workingState, () => false)
    await update($, animState, anim => {
      const left = Math.max(0, anim.left - 1)
      if (anim.left > 0 && left === 0 && anim.mood !== 'sleep') return { ...IDLE, tick: anim.tick + 1 }
      return { ...anim, tick: anim.tick + 1, left }
    })
    await syncTicker($)
  } catch {
    // A missed frame is not worth a failure.
  }
}

/** Starts the 5 minute countdown to sleep, unless working or hidden. */
async function armSleep($: $) {
  const seq = ++sleepSeq
  sleeper?.cancel()
  sleeper = undefined
  const pet = await read($, petState)
  const isWorking = await read($, workingState)
  if (seq !== sleepSeq || !isInteractive || pet === null || pet.hidden || isWorking) return
  sleeper = $.clock.after(SLEEP_MS, () => {
    sleeper = undefined
    void fallAsleep($)
  })
}

async function fallAsleep($: $) {
  try {
    const pet = await read($, petState)
    if (pet === null || pet.hidden || (await read($, workingState))) return
    const line = pet.hatch === undefined ? 'The egg is dreaming' : `${nameOf(pet)} dozed off`
    await update($, animState, () => ({ mood: 'sleep', tick: 0, left: DURATION.sleep, line }))
    await syncTicker($)
  } catch {
    // Staying awake is fine.
  }
}

/** Anything happened: wake up and restart the countdown to sleep. */
async function touch($: $) {
  quietTicks = 0
  await update($, animState, anim => (anim.mood === 'sleep' ? { ...IDLE, tick: anim.tick } : anim))
  await armSleep($)
}

// ------------------------------------------------------------ moods

async function setMood($: $, mood: HatchlingMood, line: string, from?: HatchlingStage) {
  await update($, animState, anim =>
    anim.left > 0 && PRIORITY[mood] < PRIORITY[anim.mood]
      ? anim
      : { mood, tick: 0, left: DURATION[mood], line, ...(from === undefined ? {} : { from }) },
  )
  await syncTicker($)
}

/** Turns a saved change into a reaction: hatch, evolve, or a mood. */
async function react($: $, change: Change, mood?: 'happy' | 'sweat' | 'cheer', tool = '') {
  const pet = change.pet
  const name = nameOf(pet)
  if (change.isHatched && pet.hatch !== undefined) {
    const kind = `${pet.hatch.shiny ? 'shiny ' : ''}${rarityOf(pet.hatch.species)} ${speciesArt(pet.hatch.species).name}`
    const article = /^[aeiou]/.test(kind) ? 'an' : 'a'
    $.ui.toast(`Your egg hatched! Meet ${name}, ${article} ${kind}.`, { timeoutMs: 8000 })
    await setMood($, 'hatch', `Crack! ${name} hatched - ${article} ${kind}`)
  } else if (change.evolved !== undefined) {
    const to = change.evolved.to
    $.ui.toast(`${name} evolved into ${to === 'adult' ? 'an adult' : 'a teen'}!`, { timeoutMs: 8000 })
    await setMood($, 'evolve', `${name} is evolving!`, change.evolved.from)
  } else if (pet.hatch !== undefined && mood !== undefined) {
    const line =
      mood === 'cheer'
        ? `${name} is cheering - tests passed`
        : mood === 'sweat'
          ? `${name} is sweating - ${tool} failed`
          : `${name} bounces - ${tool} worked`
    await setMood($, mood, line)
  }
}

export const register: Register = on => {
  // ------------------------------------------------------------ events

  on('session.start', async ($, e, next) => {
    stopTimers()
    isInteractive = e.isInteractive
    await $.command.register({
      name: 'pet',
      description: 'Your pixel pet: stats, name, hide, show, share card',
      argumentHint: '[name <name> | hide | show | card]',
      immediate: true,
    })
    try {
      // First run: this saves a fresh egg. Later runs: this loads the saved pet.
      await commit($, same)
      await update($, animState, () => IDLE)
      await update($, workingState, () => false)
      await touch($)
    } catch {
      // No pet this session (the store could not be read); the session goes on.
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') stopTimers()
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    try {
      await update($, workingState, () => true)
      await touch($)
      await syncTicker($)
    } catch {
      // The pet never holds up a turn.
    }
    return next(e)
  })

  // Every finished tool call: count it, then react to how it went. The pet
  // never refuses or changes a call. If the bookkeeping fails, the .catch
  // hands back the result the tool already produced (next.called replays it;
  // nothing runs twice), so a broken store never costs you a tool call.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const hasFailed = ran.isError === true
    const hasPassedTests = !hasFailed && e.tool === 'Bash' && detectTestPass(e.command, ran.text ?? '')
    const change = await commit($, (pet, now) => applyToolCall(pet, { hasPassedTests }, now, cryptoU32))
    await touch($)
    await react($, change, hasFailed ? 'sweat' : hasPassedTests ? 'cheer' : 'happy', toolLabel(String(e.tool)))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // A subagent's run raises turn.complete too; only your own turns count.
    if (e.agentId !== undefined) return done
    try {
      await update($, workingState, () => false)
      if (e.reason === 'answer') await react($, await commit($, pet => applyTurn(pet)))
      await touch($)
      await syncTicker($)
    } catch {
      // XP can wait for the next turn.
    }
    return done
  })

  // ------------------------------------------------------------ /pet

  on('command.run', { command: 'pet' }, async ($, e) => {
    const args = e.args.trim()
    const verb = (args.split(/\s+/)[0] ?? '').toLowerCase()

    if (verb === '') {
      const { pet } = await commit($, same)
      return { text: statText(pet, await $.clock.now()) }
    }
    if (verb === 'card') {
      const { pet } = await commit($, same)
      return { text: `\`\`\`\n${cardText(pet, await $.clock.now())}\n\`\`\`` }
    }
    if (verb === 'name') {
      const result = cleanName(args.slice(verb.length))
      if ('error' in result) return { text: result.error }
      const { pet } = await commit($, pet => same({ ...pet, name: result.name }))
      return { text: pet.hatch === undefined ? `The egg will hatch as ${result.name}.` : `Your pet is now called ${result.name}.` }
    }
    if (verb === 'hide') {
      const { pet } = await commit($, pet => same({ ...pet, hidden: true }))
      stopTimers()
      return { text: `${nameOf(pet)} is hidden. /pet show brings the band back.` }
    }
    if (verb === 'show') {
      const { pet } = await commit($, pet => same({ ...pet, hidden: false }))
      await update($, animState, () => IDLE)
      await touch($)
      await syncTicker($)
      return { text: `${nameOf(pet)} is back above your prompt.` }
    }
    return { text: HELP }
  })

  // ------------------------------------------------------------ drawing

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const pet = await read($, petState)
    if (pet === null || pet.hidden) return next(e)
    const anim = await read($, animState)
    const isWorking = e.props.isWorking || (await read($, workingState))
    const frame = drawFrame(viewOf(pet, anim), anim.mood, anim.tick, isWorking)
    const cells = toCells(frame)
    const accent = accentOf(pet)
    const line = anim.line !== '' ? anim.line : idleLine(pet, anim.mood, isWorking)
    const { Box, Text } = $.ui.resolve(e)
    // Other mods share this band: the pet draws on top of what they draw,
    // never in place of it.
    const below = await next(e)

    // Too narrow or too short for the sprite: one line instead.
    const width = e.props.bodyColumns
    if (width < frame.w + 20 || e.props.maxRows < cells.length) {
      return (
        <Box flexDirection="column">
          <Box key="band">
            <Text wrap="truncate-end">
              <Text color={accent}>{bar(progressOf(pet), 5)}</Text>
              {` ${line}`}
            </Text>
          </Box>
          {below}
        </Box>
      )
    }

    let sprite = spriteRows({ Box, Text }, cells, 'sprite', '\u00a0')
    if (e.surface === 'terminal') {
      // The terminal has a cell grid element: one Raster, not a Text per run.
      const { Raster } = $.ui.resolve(e)
      sprite = <Raster key="sprite" columns={frame.w} rows={cells.length} cells={rasterCells(cells)} />
    }
    const barWidth = Math.max(6, Math.min(16, width - frame.w - 16))
    return (
      <Box flexDirection="column">
        <Box key="band" flexDirection="row" gap={2} alignItems="center">
          {sprite}
          <Box key="info" flexDirection="column">
            <Text wrap="truncate-end">
              <Text bold>{nameOf(pet)}</Text>
              {'  '}
              {pet.hatch === undefined ? (
                <Text dimColor>{bandTag(pet)}</Text>
              ) : (
                <Text color={RARITY_COLOR[rarityOf(pet.hatch.species)]}>{rarityOf(pet.hatch.species)}</Text>
              )}
              {pet.hatch === undefined ? null : <Text dimColor>{` - ${stageOf(pet)}`}</Text>}
              {pet.hatch?.shiny === true ? <Text color={RARITY_COLOR.legendary}>{' - shiny'}</Text> : null}
            </Text>
            <Text wrap="truncate-end">{line}</Text>
            <Text wrap="truncate-end">
              <Text color={accent}>{bar(progressOf(pet), barWidth)}</Text>
              <Text dimColor>{` ${shortProgress(pet)}`}</Text>
            </Text>
          </Box>
        </Box>
        {below}
      </Box>
    )
  })

  // /pet and /pet card rows: the pet as it was when the command ran, read
  // back from the row's own text (never live state, so old rows stay put).
  on('ui.render', { component: 'CommandOutput', props: { command: 'pet' } }, async ($, e, next) => {
    const info = parseCard(e.props.text)
    if (info === undefined || e.props.isErrored) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const blank = e.surface === 'terminal' ? ' ' : '\u00a0'
    const body = e.props.text.replace(/^```\n?/, '').replace(/\n?```\s*$/, '')

    if (e.props.args.trim().toLowerCase() === 'card') {
      // Draw exactly what Copy puts on the clipboard, in the theme's own text
      // colour so it reads on light and dark backgrounds alike.
      const copy = async (surface: typeof e.surface) => {
        const done = await $.ui.copy({ text: body, surface })
        $.ui.toast(done.isCopied ? 'Card copied - paste it anywhere.' : 'No clipboard here - select the card text to copy it.')
      }
      return (
        <Box key="card" flexDirection="column">
          {body.split('\n').map(text => (
            <Text>{text.replace(/ /g, blank)}</Text>
          ))}
          <Button key="copy" label="Copy card" onPress={press => void copy(press.surface)} />
        </Box>
      )
    }

    const portrait = drawFrame({ ...info }, info.stage === 'egg' ? 'idle' : 'happy', 1, false)
    const lines = body.split('\n')
    return (
      <Box key="stats" flexDirection="row" gap={2} alignItems="center">
        {spriteRows({ Box, Text }, toCells(portrait), 'portrait', blank)}
        <Box flexDirection="column">
          {lines.map((text, i) =>
            i === 0 ? (
              <Text bold>{text}</Text>
            ) : (
              <Text dimColor={i > 1}>{text}</Text>
            ),
          )}
        </Box>
      </Box>
    )
  })
}

// -------------------------------------------------------------- helpers

function viewOf(pet: HatchlingPet, anim: HatchlingAnim): View {
  const view: View = {
    stage: stageOf(pet),
    shiny: pet.hatch?.shiny ?? false,
    eggCalls: pet.eggCalls,
  }
  if (pet.hatch !== undefined) view.species = pet.hatch.species
  if (anim.mood === 'evolve' && anim.from !== undefined) view.from = anim.from
  return view
}

function speciesAccent(species: NonNullable<HatchlingPet['hatch']>['species'], shiny: boolean): string {
  const art = speciesArt(species)
  return shiny ? art.shinyAccent : art.accent
}

function accentOf(pet: HatchlingPet): string {
  return pet.hatch === undefined ? EGG_ACCENT : speciesAccent(pet.hatch.species, pet.hatch.shiny)
}

function idleLine(pet: HatchlingPet, mood: HatchlingMood, isWorking: boolean): string {
  const name = nameOf(pet)
  if (pet.hatch === undefined) {
    if (mood === 'sleep') return 'The egg is dreaming'
    return isWorking ? 'The egg is wobbling...' : 'Something stirs inside the egg'
  }
  if (mood === 'sleep') return `${name} is asleep`
  return isWorking ? `${name} is watching Claude work` : `${name} is hanging out`
}

function bar(progress: number, width: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, progress)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The egg's countdown, after its name. */
function bandTag(pet: HatchlingPet): string {
  const left = HATCH_AT - pet.eggCalls
  return `hatches in ${left} tool call${left === 1 ? '' : 's'}`
}

function shortProgress(pet: HatchlingPet): string {
  if (pet.hatch === undefined) return `${pet.eggCalls}/${HATCH_AT} to hatch`
  const stage = stageOf(pet)
  if (stage === 'adult') return `${pet.xp} XP`
  return `${pet.xp}/${stage === 'baby' ? TEEN_XP : ADULT_XP} XP`
}

/** Text-cell sprite for surfaces without a Raster: one Text per row of runs. */
function spriteRows({ Box, Text }: Tags, cells: readonly (readonly Cell[])[], key: string, blank: string) {
  return (
    <Box key={key} flexDirection="column">
      {cells.map(line => (
        <Text>
          {toRuns(line).map(run => {
            const text = run.text.replace(/ /g, blank)
            if (run.fg === undefined && run.bg === undefined) return text
            const paint: TextProps = {}
            if (run.fg !== undefined) paint.color = run.fg
            if (run.bg !== undefined) paint.backgroundColor = run.bg
            return <Text {...paint}>{text}</Text>
          })}
        </Text>
      ))}
    </Box>
  )
}
