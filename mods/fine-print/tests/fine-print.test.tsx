// Behaviour through the real wiring: turns end via $.turn.complete, the model
// is answered beneath the plugin, the band is mounted and pressed on both
// surfaces, and /fineprint runs as a command.

import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type {
  CommandRunInput,
  CommandSpec,
  PaneOpenArgs,
  ModelCompleteInput,
  ModelCompleteResult,
  On,
  PromptSubmitInput,
  RenderSurface,
  SessionMessage,
  TurnCompleteInput,
} from 'claude-code'

const PLUGIN = 'fine-print'
const SURFACES = ['terminal', 'desktop'] as const
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

// 160+ words: over the threshold.
const LONG_REPLY = Array.from(
  { length: 20 },
  (_, index) => `Step ${index + 1}: I deployed the new build to production and kept the old database running.`,
).join(' ')
const SHORT_REPLY = 'Done. All tests pass and the branch is pushed.'
// A file's contents, which must never reach the model.
const SECRET = 'TOKEN=hunter2-never-send-this'

const MESSAGES: SessionMessage[] = [
  { role: 'user', text: 'an earlier prompt', toolUses: [] },
  { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'old', tool: 'Bash', input: { command: 'echo OLD_TURN_MARKER' } }] },
  { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: 'old', text: 'ok', isError: false }] },
  { role: 'assistant', text: 'Earlier answer.', toolUses: [] },
  { role: 'user', text: 'ship it', toolUses: [] },
  {
    role: 'assistant',
    text: '',
    toolUses: [
      { tool_use_id: 'w', tool: 'Write', input: { file_path: '/app/.env', content: SECRET } },
      { tool_use_id: 'b', tool: 'Bash', input: { command: 'fly deploy --app prod\necho done' } },
    ],
  },
  {
    role: 'user',
    text: '',
    toolUses: [],
    toolResults: [
      { tool_use_id: 'w', text: 'written', isError: false },
      { tool_use_id: 'b', text: 'deployed', isError: false },
    ],
  },
  { role: 'assistant', text: LONG_REPLY, toolUses: [] },
]

const FLAG = {
  flag: true,
  topics: ['cost', 'irreversible'],
  headline: 'The old database keeps running and billing',
  bullets: ['Production now runs the new build', 'The old database was not shut down'],
}

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 96, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

type Answer = string | ModelCompleteResult
type World = {
  registered: CommandSpec[]
  opened: PaneOpenArgs[]
  logs: string[]
  calls: ModelCompleteInput[]
  statuses: (string | undefined)[]
  toasts: string[]
  submitted: PromptSubmitInput[]
  clock: MockClock
}

// The world beneath the plugin: each noun it calls, answered and recorded.
type Setup = {
  submit?: 'ok' | 'drop'
  dropReason?: string
  panes?: boolean
  surfaces?: readonly RenderSurface[]
  messages?: SessionMessage[] | 'deny'
}

function world(on: On, answers: Answer[], setup: Setup = {}): World {
  const { submit = 'ok', dropReason = 'a hook refused it', panes = true, surfaces = ['terminal'], messages = MESSAGES } = setup
  const seen: World = {
    registered: [],
    opened: [],
    logs: [],
    calls: [],
    statuses: [],
    toasts: [],
    submitted: [],
    clock: mock.clock(on, { now: 1_000_000 }),
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', ($, e) => ((seen.registered.push(e), { value: { command: e.name } })))
  on('ui.open', ($, e) => {
    seen.opened.push(e)

    return { value: panes ? { isPlaced: true } : { isPlaced: false, reason: 'no attached surface seats panes' } }
  })
  on('session.messages', () => (messages === 'deny' ? { deny: 'transcript unavailable' } : { value: messages }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('model.complete', ($, e) => {
    seen.calls.push(e)
    const answer = answers[Math.min(seen.calls.length, answers.length) - 1] ?? '{"flag": false}'

    return { value: typeof answer === 'string' ? { isAnswered: true, text: answer, usage: ZERO } : answer }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.status', ($, e) => ((seen.statuses.push(e.text), { value: undefined })))
  on('ui.toast', ($, e) => ((seen.toasts.push(e.text), { value: undefined })))
  on('ui.log', ($, e) => {
    if (e.to === 'transcript') seen.logs.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e)

    return submit === 'ok' ? { text: e.text } : { drop: dropReason }
  })
  // What the engine draws in the band when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine band</Text>
  })

  return seen
}

function turn(answer: string, turnId = 't1'): TurnCompleteInput {
  return { answer, durationMs: 2000, isAborted: false, turnId, reason: 'answer' }
}

const FINEPRINT: CommandRunInput = {
  command: 'fineprint',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
}

const PANE_PROPS = {
  title: 'Fine Print',
  isFocused: true,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

// Runs /fineprint as the person does and reads the pane it opens: the
// command itself answers no text, so the model never reads the list.
async function fineprint($: Engine, surface: 'terminal' | 'desktop' = 'terminal'): Promise<string> {
  const result = await $.command.run(FINEPRINT)
  expect(result).toEqual({})
  const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'fineprint', props: PANE_PROPS })
  const text = (await ui.findAll({ type: 'Text' })).map(line => line.text).join('\n')
  await ui.unmount()

  return text
}

// Ends a turn the way the session does, then lets the background check run.
async function endTurn($: { turn: { complete: (e: TurnCompleteInput) => Promise<{ text: string }> } }, seen: World, input: TurnCompleteInput) {
  const result = await $.turn.complete(input)
  await seen.clock.settle()

  return result
}

test('an important finding shows the note above the prompt, on both surfaces', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  const result = await endTurn($, seen, turn(LONG_REPLY))

  expect(result.text).toBe(LONG_REPLY)
  expect(seen.calls).toHaveLength(1)
  expect(seen.calls[0]?.model).toBe('haiku')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const headline = await ui.find({ type: 'Text', text: FLAG.headline })
    expect(headline?.props.bold).toBe(true)
    for (const bullet of FLAG.bullets) expect(await ui.find({ type: 'Text', text: bullet })).toBeDefined()
    const labels = (await ui.findAll({ type: 'Button' })).map(button => button.text)
    expect(labels).toEqual(['Got it', 'Explain more', 'Dismiss'])
    // Explain more spends a turn, so no letter key may press it; the others only close the note.
    expect((await ui.find({ key: 'explain' }))?.props.hotkey).toBeUndefined()
    expect((await ui.find({ key: 'got-it' }))?.props.hotkey).toBe('g')
    expect((await ui.find({ key: 'dismiss' }))?.props.hotkey).toBe('d')
    // What is beneath still draws, under the note.
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
})

test('the model is sent the reply and tool names and targets, never file contents', async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  await endTurn($, seen, turn(LONG_REPLY))

  const sent = `${seen.calls[0]?.system ?? ''}\n${seen.calls[0]?.prompt ?? ''}`
  expect(sent).toContain(LONG_REPLY)
  expect(sent).toContain('Write (file_path: /app/.env)')
  expect(sent).toContain('Bash (command: fly deploy --app prod)')
  expect(sent).not.toContain(SECRET)
  expect(sent).not.toContain('echo done')
  // Only this turn's calls.
  expect(sent).not.toContain('OLD_TURN_MARKER')
  expect(seen.calls[0]?.maxTokens).toBe(1024)
  expect(seen.calls[0]?.effort).toBe('low')
})

test('a secret in a command is masked before it reaches the model', async ($, on) => {
  const rows: SessionMessage[] = [
    { role: 'user', text: 'call the api', toolUses: [] },
    {
      role: 'assistant',
      text: LONG_REPLY,
      toolUses: [{ tool_use_id: 'c', tool: 'Bash', input: { command: 'curl -H "Authorization: Bearer sk-live-SECRET123456" https://api.example.com' } }],
    },
  ]
  const seen = world(on, ['{"flag": false}'], { messages: rows })
  await endTurn($, seen, turn(LONG_REPLY))

  expect(seen.calls[0]?.prompt).toContain('Bash (command: curl -H "Authorization: [hidden]" https://api.example.com)')
  expect(seen.calls[0]?.prompt).not.toContain('SECRET123456')
})

test('the turn ends before the model is asked', async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  await $.turn.complete(turn(LONG_REPLY))
  expect(seen.calls.length).toBe(0)
  await seen.clock.settle()
  expect(seen.calls.length).toBe(1)
})

test('turn.complete hands on what is beneath', async ($, on) => {
  on('turn.complete', () => ({ text: 'from beneath' }))
  expect((await $.turn.complete(turn(SHORT_REPLY))).text).toBe('from beneath')
})

test('error and refusal turns are not checked', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, { answer: LONG_REPLY, durationMs: 1, isAborted: false, turnId: 'e', reason: 'error' })
  await endTurn($, seen, {
    answer: LONG_REPLY,
    durationMs: 1,
    isAborted: false,
    turnId: 'r',
    reason: 'refusal',
    refusal: { category: null, explanation: null },
  })
  expect(seen.calls).toHaveLength(0)
})

test('a run where nothing draws (-p) spends no checks', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { surfaces: [] })
  await endTurn($, seen, turn(LONG_REPLY))
  expect(seen.calls).toHaveLength(0)
  expect((await fineprint($))).toContain('Checks used this session: 0 of 30.')
})

test('the answer to Explain more is not checked again', async ($, on) => {
  const rows: SessionMessage[] = [...MESSAGES]
  const seen = world(on, [JSON.stringify(FLAG), JSON.stringify(FLAG)], { messages: rows })
  await endTurn($, seen, turn(LONG_REPLY, 'first'))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'explain' })
  rows.push({ role: 'user', text: seen.submitted[0]?.text ?? '', toolUses: [] }, { role: 'assistant', text: LONG_REPLY, toolUses: [] })
  await endTurn($, seen, turn(LONG_REPLY, 'explained'))

  expect(seen.calls).toHaveLength(1)
  const listed = (await fineprint($))
  expect(listed).toContain('Fine Print: 1 note this session')
  // Nor does it cost a check.
  expect(listed).toContain('Checks used this session: 1 of 30.')
})

test('nothing important: silent', async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  await endTurn($, seen, turn(LONG_REPLY))

  expect(seen.calls).toHaveLength(1)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect(await ui.find({ key: 'got-it' })).toBeUndefined()
    await ui.unmount()
  }
  expect(seen.toasts).toEqual([])
  expect(seen.statuses).toEqual([])
})

for (const [name, answer] of [
  ['cut-off JSON', '{"flag": true, "headline": "Half an ans'],
  ['invalid JSON', "{flag: true, headline: 'Unquoted keys', topics: ['cost']}"],
  ['prose, no JSON', 'Yes, there is a cost risk here.'],
  ['a flag with no headline', '{"flag": true, "topics": ["cost"]}'],
  ['a flag on no listed topic', '{"flag": true, "headline": "Something", "topics": ["vibes"]}'],
] as const) {
  test(`${name}: silent, and nothing breaks`, async ($, on) => {
    const seen = world(on, [answer])
    const result = await endTurn($, seen, turn(LONG_REPLY))

    expect(result.text).toBe(LONG_REPLY)
    expect(seen.calls).toHaveLength(1)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    expect((await fineprint($))).toContain('has flagged nothing')
  })
}

test('short, aborted and subagent turns never call the model', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(SHORT_REPLY))
  await endTurn($, seen, { answer: LONG_REPLY, durationMs: 1, isAborted: true, turnId: 'a', reason: 'aborted' })
  await endTurn($, seen, { ...turn(LONG_REPLY, 's'), agentId: 'sub-1' })

  expect(seen.calls).toHaveLength(0)
  expect((await fineprint($))).toContain('Checks used this session: 0 of 30.')
})

test('a reply just over 150 words is checked, one at 150 is not', async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  await endTurn($, seen, turn(Array.from({ length: 150 }, () => 'word').join(' ')))
  expect(seen.calls).toHaveLength(0)
  await endTurn($, seen, turn(Array.from({ length: 151 }, () => 'word').join(' ')))
  expect(seen.calls).toHaveLength(1)
})

test('the cap stops checks and says so once in the status line', { options: { maxChecksPerSession: 2 } }, async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  for (const id of ['1', '2', '3', '4']) await endTurn($, seen, turn(LONG_REPLY, id))

  expect(seen.calls).toHaveLength(2)
  expect(seen.statuses).toHaveLength(1)
  expect(seen.statuses[0]).toContain('all 2 checks')
  expect((await fineprint($))).toContain('Checks used this session: 2 of 2.')
})

test('/clear starts fresh: notes, band, spend and the cap line', { options: { maxChecksPerSession: 1 } }, async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG), '{"flag": false}'])
  await endTurn($, seen, turn(LONG_REPLY, 'before'))
  expect(seen.statuses).toEqual([expect.stringContaining('all 1 checks')])

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(seen.statuses).toEqual([expect.stringContaining('all 1 checks'), undefined])
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'got-it' })).toBeUndefined()
  expect((await fineprint($))).toContain('has flagged nothing this session. Checks used this session: 0 of 1.')

  await endTurn($, seen, turn(LONG_REPLY, 'after'))
  expect(seen.calls).toHaveLength(2)
})

test('other session ends keep the notes', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))
  await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
  expect((await fineprint($))).toContain(FLAG.headline)
})

test('a reload puts the cap line back up', { options: { maxChecksPerSession: 1 } }, async ($, on) => {
  const seen = world(on, ['{"flag": false}'])
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(seen.statuses).toEqual([])
  await endTurn($, seen, turn(LONG_REPLY))
  expect(seen.statuses).toHaveLength(1)

  // session.start is raised again on a reload of the module.
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(seen.statuses).toHaveLength(2)
  expect(seen.statuses[1]).toBe(seen.statuses[0])
})

test('maxChecksPerSession 0 never calls the model', { options: { maxChecksPerSession: 0 } }, async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))
  await endTurn($, seen, turn(LONG_REPLY, 't2'))

  expect(seen.calls).toHaveLength(0)
  expect(seen.statuses).toEqual(['Fine Print is off: maxChecksPerSession is 0.'])
})

test('watchFor none turns checks off', { options: { watchFor: ['none'] } }, async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))
  expect(seen.calls).toHaveLength(0)
})

test('watchFor narrows the topics sent and shown', { options: { watchFor: ['security'] } }, async ($, on) => {
  // FLAG names cost and irreversible only, which this person does not watch.
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))

  expect(seen.calls[0]?.prompt).toContain('- security:')
  expect(seen.calls[0]?.prompt).not.toContain('- cost:')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'got-it' })).toBeUndefined()
})

for (const surface of SURFACES) {
  test(`Got it and Dismiss close the note and record it (${surface})`, async ($, on) => {
    const seen = world(on, [JSON.stringify(FLAG), JSON.stringify({ ...FLAG, headline: 'Second note' })])

    await endTurn($, seen, turn(LONG_REPLY, 'first'))
    let ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    await ui.press({ key: 'got-it' })
    expect(await ui.find({ key: 'got-it' })).toBeUndefined()
    await ui.unmount()

    await endTurn($, seen, turn(LONG_REPLY, 'second'))
    ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: 'Second note' })).toBeDefined()
    await ui.press({ key: 'dismiss' })
    expect(await ui.find({ key: 'dismiss' })).toBeUndefined()
    expect(await ui.find({ text: 'engine band' })).toBeDefined()

    const listed = await fineprint($)
    expect(listed).toContain('1. Second note (dismissed')
    expect(listed).toContain(`2. ${FLAG.headline} (got it`)
    expect(seen.submitted).toEqual([])
  })

  test(`Explain more sends a follow-up framed as the plugin's (${surface})`, async ($, on) => {
    const seen = world(on, [JSON.stringify(FLAG)])
    await endTurn($, seen, turn(LONG_REPLY))

    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    await ui.press({ key: 'explain' })

    expect(seen.submitted).toHaveLength(1)
    expect(seen.submitted[0]?.text).toContain(FLAG.headline)
    expect(seen.submitted[0]?.text).toContain('Fine Print (a second-reader plugin)')
    expect(seen.submitted[0]?.origin).toEqual({ kind: 'plugin', name: PLUGIN })
    expect(await ui.find({ key: 'explain' })).toBeUndefined()
    expect((await fineprint($))).toContain('(asked to explain')
    expect(seen.toasts).toEqual([])
  })
}

test('a second Explain more press sends nothing more', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  // Both presses land on the drawing as it stood, before any redraw.
  await Promise.all([ui.press({ key: 'explain' }), ui.press({ key: 'explain' })].map(press => press.catch(() => undefined)))
  expect(seen.submitted).toHaveLength(1)
})

test('/fineprint says so when it cannot open its notes', async ($, on) => {
  // Nothing beneath answers ui.open: the command throws, and its .catch answers.
  const toasts: string[] = []
  on('ui.toast', ($, e) => ((toasts.push(e.text), { value: undefined })))
  const result = await $.command.run(FINEPRINT)
  expect(result).toEqual({})
  expect(toasts).toEqual(['Fine Print could not open its notes.'])
})

test('/fineprint opens a pane and answers no text, so the model never reads the list', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))

  for (const surface of SURFACES) {
    const listed = await fineprint($, surface)
    expect(listed).toContain(`1. ${FLAG.headline} (open`)
    expect(listed).toContain(`   - ${FLAG.bullets[0]}`)
  }
  expect(seen.opened[0]).toMatchObject({ id: 'fineprint', title: 'Fine Print', focus: true, closeOnEscape: true })
  expect(seen.logs).toEqual([])
})

test('where no surface seats a pane, the list is a transcript line the model does not read', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { panes: false })
  await endTurn($, seen, turn(LONG_REPLY))

  expect(await $.command.run(FINEPRINT)).toEqual({})
  expect(seen.logs).toHaveLength(1)
  expect(seen.logs[0]).toContain(`1. ${FLAG.headline} (open`)
  expect(seen.logs[0]).toContain('Checks used this session: 1 of 30.')
})

test('Explain more says so when the question could not be sent', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { submit: 'drop' })
  await endTurn($, seen, turn(LONG_REPLY))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'explain' })

  expect(seen.submitted).toHaveLength(1)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('could not send the question')
  // The note is back, still open, and can be tried again.
  expect(await ui.find({ key: 'explain' })).toBeDefined()
  expect((await fineprint($))).toContain(`1. ${FLAG.headline} (open`)
})

test('a failing model is silent in the band and toasts once per session', async ($, on) => {
  const failure: ModelCompleteResult = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: ZERO }
  const seen = world(on, [failure])
  await endTurn($, seen, turn(LONG_REPLY, '1'))
  await endTurn($, seen, turn(LONG_REPLY, '2'))

  expect(seen.calls).toHaveLength(2)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('overloaded')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'got-it' })).toBeUndefined()
})

test('/fineprint is registered and lists every note, newest first', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG), JSON.stringify({ ...FLAG, headline: 'Newer note' })])

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(seen.registered).toEqual([{ name: 'fineprint', description: expect.any(String), immediate: true }])

  await endTurn($, seen, turn(LONG_REPLY, 'a'))
  await seen.clock.advance(5 * 60_000)
  await endTurn($, seen, turn(LONG_REPLY, 'b'))

  const listed = await fineprint($)
  expect(listed).toContain('Fine Print: 2 notes this session, newest first.')
  expect(listed.indexOf('Newer note')).toBeLessThan(listed.indexOf(FLAG.headline))
  expect(listed).toContain(`2. ${FLAG.headline} (open, 5 min ago; cost, irreversible)`)
  expect(listed).toContain('Checks used this session: 2 of 30.')

  // The band shows the newest and points at the older open one.
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Newer note' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 more open note/ })).toBeDefined()
})

test('only open notes count as more open notes', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG), JSON.stringify({ ...FLAG, headline: 'Second note' })])
  await endTurn($, seen, turn(LONG_REPLY, 'first'))
  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'got-it' })
  await ui.unmount()
  await endTurn($, seen, turn(LONG_REPLY, 'second'))
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: 'Second note' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /more open note/ })).toBeUndefined()
})

// Another mod's band, loaded beneath this one (the append tier sits under user).
const OTHER_BAND = {
  name: 'other-band',
  tier: 'append',
  register(on) {
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box key="other-band">
          <Text>another mod's band</Text>
        </Box>
      )
    })
  },
} satisfies Plugin

test('a note keeps other mods\' bands, drawn above it, on both surfaces', { plugins: [OTHER_BAND] }, async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    // No note yet: the other band alone.
    expect(await ui.find({ type: 'Text', text: "another mod's band" })).toBeDefined()
    expect(await ui.find({ key: 'got-it' })).toBeUndefined()
    await ui.unmount()
  }
  await endTurn($, seen, turn(LONG_REPLY))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const texts = (await ui.findAll({ type: 'Text' })).map(text => text.text)
    const other = texts.indexOf("another mod's band")
    const headline = texts.indexOf(FLAG.headline)
    expect(other).toBeGreaterThanOrEqual(0)
    expect(headline).toBeGreaterThanOrEqual(0)
    // The other band first, so an overflow never scrolls its buttons away.
    expect(other).toBeLessThan(headline)
    await ui.unmount()
  }
})

// Model text with every kind of control character the engine refuses to draw.
const DIRTY = {
  flag: true,
  topics: ['cost'],
  headline: '\u001b[31mBilling\u001b[0m is on\u0007 for\u0000 the\u007f old\u0085 DB\u009b2J',
  bullets: ['\u001b]0;pwned\u0007Keeps running', 'Costs\u0000 money\u009b'],
}
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/

test('a verdict full of control characters still draws the note and its buttons', { plugins: [OTHER_BAND] }, async ($, on) => {
  const seen = world(on, [JSON.stringify(DIRTY)])
  await endTurn($, seen, turn(LONG_REPLY))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    const headline = await ui.find({ type: 'Text', text: /Billing is on/ })
    expect(headline?.text).toBe('Billing is on\ufffd for\ufffd the\ufffd old\ufffd DB')
    expect(await ui.find({ type: 'Text', text: 'Keeps running' })).toBeDefined()
    expect((await ui.findAll({ type: 'Button' })).map(button => button.text)).toEqual(['Got it', 'Explain more', 'Dismiss'])
    expect(await ui.find({ type: 'Text', text: "another mod's band" })).toBeDefined()
    for (const text of await ui.findAll({ type: 'Text' })) expect(CONTROL_CHARS.test(text.text)).toBe(false)
    await ui.unmount()
  }
  const listed = await fineprint($)
  expect(listed).toContain('Billing is on')
  expect(CONTROL_CHARS.test(listed)).toBe(false)
})

test('a refusal reason with control characters toasts cleanly', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { submit: 'drop', dropReason: '\u001b[31mbusy\u001b[0m\u0007' })
  await endTurn($, seen, turn(LONG_REPLY))
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'explain' })

  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toContain('(busy\ufffd)')
  expect(CONTROL_CHARS.test(seen.toasts[0] ?? '')).toBe(false)
})

test('the note yields the band to a survey', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)])
  await endTurn($, seen, turn(LONG_REPLY))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND, props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
})

test('where no surface draws the band, the note arrives as a toast', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { surfaces: ['vscode'] })
  await endTurn($, seen, turn(LONG_REPLY))

  expect(seen.toasts).toEqual([`Fine print: ${FLAG.headline} (/fineprint has the details)`])
  expect((await fineprint($))).toContain(FLAG.headline)
})

test('on the terminal or desktop the band alone shows the note', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { surfaces: ['terminal', 'mobile'] })
  await endTurn($, seen, turn(LONG_REPLY))
  expect(seen.toasts).toEqual([])
})

test('an unreadable transcript skips the check and leaves the turn untouched', async ($, on) => {
  const seen = world(on, [JSON.stringify(FLAG)], { messages: 'deny' })
  const result = await endTurn($, seen, turn(LONG_REPLY))

  expect(result.text).toBe(LONG_REPLY)
  expect(seen.calls).toHaveLength(0)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'got-it' })).toBeUndefined()
})
