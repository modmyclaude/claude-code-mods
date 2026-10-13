// pop-quiz: a learning mode, off by default. After a turn that changed files
// with Claude's own tools (Edit, Write, NotebookEdit), every third such turn,
// one small-model call writes two short questions about the change, and the
// band above the prompt shows them with "show answer" for each and "skip".
// The model is sent the changed files' names and a short diff, redacted and
// capped, never anything else. No grading: answers are only shown.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { PopQuizQuestion, PopQuizScore } from '../types'
import { MAX_TOKENS, MODEL, SYSTEM, TIMEOUT_MS, ZERO, buildPrompt, changeOf, costOf, isQuizTurn, parseReply, scoreOf, scoreWords, summarize } from './logic'
import type { Change } from './logic'

const quiz = atom({ plugin: 'pop-quiz', key: 'quiz' } as const, null as PopQuizQuestion[] | null)
const isOnSet = atom({ plugin: 'pop-quiz', key: 'isOn' } as const, null as boolean | null)
const everySet = atom({ plugin: 'pop-quiz', key: 'every' } as const, null as number | null)
const score = atom({ plugin: 'pop-quiz', key: 'score' } as const, ZERO as PopQuizScore)
const spent = atom({ plugin: 'pop-quiz', key: 'usd' } as const, 0)

const ALL_TIME = 'allTime'
/** Origins that are the person: typed, the phone bridge, the desktop app's box. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

/** `isEnabled`: the switch (on unless set off); `startOn`: quiz in every session without /pop-quiz on. */
type Settings = { isEnabled: boolean; startOn: boolean; every: number }

export function readSettings(options: Record<string, unknown>): Settings {
  const turns = typeof options.every === 'number' && Number.isFinite(options.every) ? Math.min(20, Math.max(1, Math.round(options.every))) : 3
  return { isEnabled: options.enabled !== false, startOn: options.startOn === true, every: turns }
}

const OFF_TEXT = 'Pop Quiz is off. /mods or /config turns it on.'

// What lives only as long as this copy of the module: the settings, this turn's changes, the
// last changed turn's (for /pop-quiz ask), how many turns changed files, and an epoch that moves
// on at every prompt and turn start (and the switch going off) so a quiz for an older turn is dropped.
let settings: Settings = readSettings({})
let turnChanges: Change[] = []
let lastChanges: Change[] = []
let changedTurns = 0
let epoch = 0
let isAsking = false

function debug($: EngineInterface, text: string): void {
  $.ui.log(`pop-quiz: ${text}`, { to: 'debug' })
}

/** Quizzing: the switch on, and /pop-quiz on typed this session (else the start setting). */
async function isOn($: EngineInterface): Promise<boolean> {
  return settings.isEnabled && ((await read($, isOnSet)) ?? settings.startOn)
}

async function every($: EngineInterface): Promise<number> {
  return (await read($, everySet)) ?? settings.every
}

async function bump($: EngineInterface, key: keyof PopQuizScore): Promise<void> {
  await update($, score, s => ({ ...s, [key]: s[key] + 1 }))
  const all = scoreOf(await $.store.get(ALL_TIME))
  await $.store.set(ALL_TIME, { ...all, [key]: all[key] + 1 })
}

async function readEnv($: EngineInterface): Promise<string | undefined> {
  try {
    return (await $.env.get('ANTHROPIC_DEFAULT_HAIKU_MODEL')) ?? (await $.env.get('ANTHROPIC_SMALL_FAST_MODEL'))
  } catch {
    return undefined
  }
}

/** One call: the `haiku` alias, else the environment's small model when the alias is refused. */
async function complete($: EngineInterface, prompt: string): Promise<ModelCompleteResult | null> {
  const ask = { system: SYSTEM, prompt, maxTokens: MAX_TOKENS, effort: 'low', timeoutMs: TIMEOUT_MS } as const
  try {
    return await $.model.complete({ ...ask, model: MODEL })
  } catch (refusal) {
    const other = await readEnv($)
    if (other === undefined || other === MODEL) {
      debug($, `model refused: ${String(refusal)}`)
      return null
    }
    try {
      return await $.model.complete({ ...ask, model: other })
    } catch (again) {
      debug($, `model refused: ${String(again)}`)
      return null
    }
  }
}

/**
 * Asks for two questions about `changes`; one retry, then silence. Dropped if the person moved on.
 * A quiz the person did not ask for makes no call, first or retry, once the switch is off.
 */
async function askAbout($: EngineInterface, at: number, changes: readonly Change[], isByPerson = false): Promise<void> {
  if (isAsking || changes.length === 0) return
  const surfaces = await $.session.surfaces()
  if (!surfaces.some(s => s === 'terminal' || s === 'desktop')) return debug($, 'no surface draws the band: no call')
  isAsking = true
  try {
    const prompt = buildPrompt(summarize(changes, await $.session.root()))
    let questions = null
    for (let attempt = 0; attempt < 2 && questions === null; attempt++) {
      // Switched off, no call at all; turned off by /pop-quiz off, none the person did not ask for.
      if (!settings.isEnabled || (!isByPerson && !(await isOn($)))) return
      const result = await complete($, prompt)
      if (result === null) return // refused: a retry would be refused too
      const cost = costOf(result.usage as { input_tokens?: number; output_tokens?: number } | undefined)
      await update($, spent, usd => usd + cost)
      questions = result.isAnswered ? parseReply(result.text) : null
    }
    if (questions === null || at !== epoch) return
    await update($, quiz, () => questions.map(q => ({ ...q, isShown: false })))
    await bump($, 'asked')
  } finally {
    isAsking = false
  }
}

async function command($: EngineInterface, args: string, origin: string): Promise<void> {
  const [verb = '', arg = ''] = args.trim().toLowerCase().split(/\s+/)
  if (verb === '' || verb === 'score') {
    const all = scoreOf(await $.store.get(ALL_TIME))
    return $.ui.toast(scoreWords(await read($, score), all, await read($, spent)))
  }
  if (verb === 'off') {
    await update($, isOnSet, () => false)
    await update($, quiz, () => null)
    return $.ui.toast('pop-quiz is off for this session.')
  }
  // Turning it on, asking now and the pace spend the person's money: theirs to type.
  if (!PERSON.has(origin)) return $.ui.toast(`pop-quiz: /pop-quiz ${verb} runs only when you type it yourself.`)
  if (verb === 'on') {
    await update($, isOnSet, () => true)
    const n = await every($)
    return $.ui.toast(`pop-quiz is on: two questions after ${n === 1 ? 'every turn' : `every ${n} turns`} that change files, about $0.0004 each.`)
  }
  if (verb === 'every') {
    const n = Number(arg)
    if (!Number.isInteger(n) || n < 1 || n > 20) return $.ui.toast('pop-quiz: /pop-quiz every <n>, from 1 to 20.')
    await update($, everySet, () => n)
    return $.ui.toast(`pop-quiz asks after ${n === 1 ? 'every turn' : `every ${n} turns`} that change files.`)
  }
  if (verb === 'ask') {
    if (lastChanges.length === 0) return $.ui.toast('pop-quiz: no turn has changed a file yet this session.')
    $.ui.toast('pop-quiz: writing two questions about the last change...')
    return askAbout($, epoch, lastChanges, true)
  }
  $.ui.toast('pop-quiz: /pop-quiz on, off, every <n>, ask, or score.')
}

export const register: Register = (on, options) => {
  settings = readSettings(options)

  // The switch (`enabled`, which /config and the modmyclaude hub flip): off, no quiz is asked or
  // drawn and every command says so; on, /pop-quiz on or the start setting decide, as before. The
  // engine reloads the mod with the new value; this makes it so at once. A quiz costs money, so
  // only the person (the menu, the bridge) or the hub on their press switches it on; anyone may
  // switch it off. Off clears the quiz and drops one still being written, as the next prompt does.
  on('config.set', { key: 'pop-quiz.enabled' }, async ($, e, next) => {
    if (e.value === true && e.origin.kind === 'plugin' && e.origin.name !== 'modmyclaude-hub') {
      return { deny: 'pop-quiz stays off: you switch it on in the /config menu or the modmyclaude hub' }
    }
    const set = await next(e)
    if (set.deny === undefined && typeof set.value === 'boolean') {
      settings = { ...settings, isEnabled: set.value }
      if (!set.value) {
        epoch++
        await update($, quiz, () => null)
      }
      $.ui.invalidate('ui.render')
    }
    return set
  })

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'pop-quiz',
        description: 'A quiz on what Claude changed: on, off, every <n>, ask, score',
        argumentHint: '[on | off | every <n> | ask | score]',
        immediate: true,
      })
    } catch (error) {
      debug($, String(error))
    }
    return next(e)
  })

  // What each tool call changed, once it ran: Edit, Write and NotebookEdit, subagents' too.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      const change = changeOf(String(e.tool), e as unknown as Record<string, unknown>)
      if (change !== null) turnChanges.push(change)
    }
    return ran
  })

  // The main loop's turns only (a subagent's work raises no turn.start).
  on('turn.start', ($, e, next) => {
    epoch++
    turnChanges = []
    return next(e)
  })

  // A main turn that answered and changed files counts; every n-th one gets a quiz, off the turn's clock.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && !e.isAborted && turnChanges.length > 0) {
      lastChanges = turnChanges
      turnChanges = []
      changedTurns++
      const at = epoch
      const changes = lastChanges
      if ((await isOn($)) && isQuizTurn(changedTurns, await every($))) $.clock.after(0, () => void askAbout($, at, changes).catch(error => debug($, String(error))))
    }
    return done
  })

  // The next prompt clears the quiz and drops one still being written.
  on('prompt.submit', async ($, e, next) => {
    epoch++
    if ((await read($, quiz)) !== null) await update($, quiz, () => null)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Two questions under the other mods' bands, each with show answer, and skip.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!settings.isEnabled) return next(e)
    const below = await next(e)
    const questions = await read($, quiz)
    if (questions === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) return below
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Text key="title" dimColor>
          pop quiz on the last change
        </Text>
        {questions.map((item, i) => (
          <Box key={`q-${i}`} flexDirection="row" gap={1}>
            <Box key="text" flexGrow={1} flexShrink={1}>
              <Text wrap="wrap">{`${i + 1}. ${item.isShown ? item.a : item.q}`}</Text>
            </Box>
            {item.isShown ? null : (
              <Button
                key={`show-${i}`}
                label="show answer"
                onPress={async () => {
                  await update($, quiz, list => (list === null ? null : list.map((q, j) => (j === i ? { ...q, isShown: true } : q))))
                  await bump($, 'shown')
                }}
              />
            )}
          </Box>
        ))}
        <Box key="foot" flexDirection="row" gap={1}>
          <Button
            key="skip"
            label="skip"
            onPress={async () => {
              await update($, quiz, () => null)
              await bump($, 'skipped')
            }}
          />
          <Text dimColor>No grading. It clears when you send your next prompt.</Text>
        </Box>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'pop-quiz' }, async ($, e) => {
    if (!settings.isEnabled) {
      $.ui.toast(OFF_TEXT)
      return {}
    }
    try {
      await command($, e.args, e.origin.kind)
    } catch (error) {
      debug($, String(error))
      $.ui.toast('pop-quiz: that command failed, and nothing changed.')
    }
    return {}
  })
}
