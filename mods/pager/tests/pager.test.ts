// Pager through the real wiring: turns end, notifications fire and commands
// run as the engine raises them; the test's hooks stand in for the player,
// the toast stack, the network and the clock beneath the plugin.

import type { On, PromptOrigin } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROOT = '/Users/someone/code/my-app'
const NOON = new Date(2026, 0, 5, 12, 0).getTime()
const SECRET_PROMPT = 'please rotate the prod-db password hunter2'
const SECRET_ANSWER = 'Rotated prod-db; new password is swordfish'
const BENEATH = 'what the chain beneath answered'

type Post = { url: string; method?: string; headers?: Record<string, string>; body?: string }

type World = {
  options?: {
    play?: 'ok' | 'fails'
    /** Why the player refuses, when it does. */
    playError?: string
    fetch?: 'ok' | 'fails'
    now?: number
    /** What draws the session; a plain `claude -p` run has nothing. */
    surfaces?: ('terminal' | 'desktop')[]
  }
}

/** The world beneath the plugin, recorded. */
function world(on: On, { options = {} }: World = {}) {
  const clock = mock.clock(on, { now: options.now ?? NOON })
  mock.store(on)
  const plays: string[] = []
  const toasts: string[] = []
  const logs: { text: string; to: string }[] = []
  const posts: Post[] = []
  const commands: { name: string; immediate?: true }[] = []
  let playing = 0
  let overlapped = false

  on('audio.play', async (_$, e) => {
    if (options.play === 'fails') return { deny: options.playError ?? 'no device' }
    // Take a little while, as a real clip does, so clips started together overlap.
    if (++playing > 1) overlapped = true
    for (let i = 0; i < 20; i++) await Promise.resolve()
    playing--
    plays.push(e.clip.asset ?? '(not an asset)')
    return { value: undefined }
  })
  on('http.fetch', (_$, e) => {
    if (options.fetch === 'fails') return { deny: 'offline' }
    posts.push({ url: e.url, ...e.init })
    return { value: { status: 200, ok: true, headers: {}, text: '' } }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    logs.push({ text: e.text, to: e.to })
    return { value: undefined }
  })
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: options.surfaces ?? ['terminal'] }))
  on('command.register', (_$, e) => {
    commands.push({ name: e.name, immediate: e.immediate })
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: BENEATH }))
  on('classic.Notification', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  return { clock, plays, toasts, logs, posts, commands, overlapped: () => overlapped }
}

type W = ReturnType<typeof world>

let turnCount = 0

async function start($: Engine, w: W) {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
}

async function endTurn($: Engine, w: W, durationMs: number, reason: 'answer' | 'error' | 'aborted' = 'answer', agentId?: string) {
  const out = await $.turn.complete({
    answer: SECRET_ANSWER,
    durationMs,
    isAborted: reason === 'aborted',
    turnId: `turn-${++turnCount}`,
    reason,
    ...(agentId === undefined ? {} : { agentId }),
  })
  await w.clock.settle()
  return out
}

async function notify($: Engine, w: W, type = 'permission_prompt') {
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: type })
  await w.clock.settle()
}

/** Runs /pager and returns the toast it answered with (taken off the toast list). */
async function pager($: Engine, w: W, args: string, origin: PromptOrigin = { kind: 'composer' }) {
  const before = w.toasts.length
  const out = await $.command.run({
    command: 'pager',
    args,
    origin,
    presentation: { isFullscreen: false, columns: 100 },
  })
  await w.clock.settle()
  // Nothing for the model to read: the answer is a toast (gotcha #18).
  expect(out.text, `/pager ${args} put text in the transcript`).toBeUndefined()
  expect(out.context).toBeUndefined()
  expect(w.toasts.length, `/pager ${args} showed no toast`).toBe(before + 1)
  return w.toasts.splice(before, 1)[0] ?? ''
}

const SIX_S = 6_000

describe('alerts', () => {
  test('a long turn plays the done clip once, with a toast naming the project', async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 25_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
    expect(w.toasts).toEqual(['Done - my-app (25s)'])
    expect(w.posts).toHaveLength(0)
  })

  test('a turn shorter than minDuration stays quiet; one at it pages', async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 19_999)
    expect(w.plays).toEqual([])
    expect(w.toasts).toEqual([])
    await endTurn($, w, 20_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
  })

  test('minDuration comes from the settings', { options: { minDuration: 5 } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 4_000)
    expect(w.plays).toEqual([])
    await endTurn($, w, 6_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
  })

  test('errors page at any length; interrupts and subagent turns never do', async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 1_500, 'error')
    expect(w.plays).toEqual(['sounds/classic/error.wav'])
    expect(w.toasts).toEqual(['Error - my-app'])

    await w.clock.advance(SIX_S)
    await $.turn.complete({
      answer: '',
      durationMs: 2_000,
      isAborted: false,
      turnId: 'refused',
      reason: 'refusal',
      refusal: { category: null, explanation: null },
    })
    await w.clock.settle()
    expect(w.plays).toEqual(['sounds/classic/error.wav', 'sounds/classic/error.wav'])

    await w.clock.advance(SIX_S)
    await endTurn($, w, 600_000, 'aborted')
    await endTurn($, w, 600_000, 'answer', 'subagent-1')
    await endTurn($, w, 600_000, 'error', 'subagent-1')
    expect(w.plays).toHaveLength(2)
    expect(w.toasts).toHaveLength(2)
  })

  test('the turn result is what the chain beneath answers', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await endTurn($, w, 30_000)).toMatchObject({ text: BENEATH })
    expect(w.plays).toHaveLength(1)
  })

  test('a turn end and a notification at the same moment make one sound', async ($, on) => {
    const w = world(on)
    await start($, w)
    await Promise.all([
      $.turn.complete({ answer: '', durationMs: 30_000, isAborted: false, turnId: 'same-moment', reason: 'answer' }),
      $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' }),
    ])
    await w.clock.settle()
    expect(w.toasts).toHaveLength(2)
    expect(w.plays).toHaveLength(1)
  })

  test('a plain claude -p run (nothing drawing) gets no sound, push or toast', { options: { ntfyTopic: 'pager-test' } }, async ($, on) => {
    const w = world(on, { options: { surfaces: [] } })
    await start($, w)
    await endTurn($, w, 1_000, 'error')
    await endTurn($, w, 60_000)
    await notify($, w)
    expect(w.plays).toEqual([])
    expect(w.posts).toEqual([])
    expect(w.toasts).toEqual([])
  })

  test('a session the desktop app draws pages like a terminal one', async ($, on) => {
    const w = world(on, { options: { surfaces: ['desktop'] } })
    // As the desktop app starts it: headless at start (gotcha #28), the window attached after.
    await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
    await w.clock.settle()
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
  })

  test('/clear forgets the old conversation title', async ($, on) => {
    const w = world(on)
    await start($, w)
    await $.classic.SessionStart({ source: 'startup', session_title: 'Old conversation about payroll' })
    await endTurn($, w, 30_000)
    await $.classic.SessionStart({ source: 'clear' })
    await w.clock.advance(SIX_S)
    await endTurn($, w, 30_000)
    expect(w.toasts).toEqual(['Done - Old conversation about payroll (30s)', 'Done - my-app (30s)'])
  })

  test('needs you plays on a permission prompt or a question, not on idle or auth notices', async ($, on) => {
    const w = world(on)
    await start($, w)
    await notify($, w, 'permission_prompt')
    expect(w.plays).toEqual(['sounds/classic/needs-you.wav'])
    expect(w.toasts).toEqual(['Needs you - my-app'])

    await w.clock.advance(SIX_S)
    await notify($, w, 'idle_prompt')
    await notify($, w, 'auth_success')
    await notify($, w, 'agent_completed')
    expect(w.plays).toHaveLength(1)

    await notify($, w, 'elicitation_dialog')
    expect(w.plays).toEqual(['sounds/classic/needs-you.wav', 'sounds/classic/needs-you.wav'])
  })

  test('at most one sound every 5 seconds, while every alert still toasts', async ($, on) => {
    const w = world(on)
    await start($, w)
    await notify($, w)
    await w.clock.advance(1_000)
    await endTurn($, w, 30_000)
    await endTurn($, w, 1_000, 'error')
    expect(w.plays).toEqual(['sounds/classic/needs-you.wav'])
    expect(w.toasts).toHaveLength(3)

    await w.clock.advance(3_999) // 4.999 s after the first sound
    await endTurn($, w, 30_000)
    expect(w.plays).toHaveLength(1)

    await w.clock.advance(1) // exactly 5 s
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/needs-you.wav', 'sounds/classic/done.wav'])
  })

  test('the toast uses the session title once the session has one', async ($, on) => {
    const w = world(on)
    await start($, w)
    await $.classic.SessionStart({ source: 'startup', session_title: 'Fix the login bug' })
    await endTurn($, w, 30_000)
    expect(w.toasts).toEqual(['Done - Fix the login bug (30s)'])

    await $.classic.UserPromptSubmit({ prompt: SECRET_PROMPT, session_title: 'Renamed later' })
    await w.clock.advance(SIX_S)
    await notify($, w)
    expect(w.toasts.at(-1)).toBe('Needs you - Renamed later')
  })

  test(
    'a session title with control characters gives a clean toast and a clean push',
    { options: { ntfyTopic: 'pager-test' } },
    async ($, on) => {
      const w = world(on)
      await start($, w)
      await $.classic.SessionStart({ source: 'startup', session_title: 'Fix \u001b[31mlogin\u001b[0m\u0007 bug\u0085' })
      await endTurn($, w, 30_000)
      expect(w.toasts).toEqual(['Done - Fix login\ufffd bug\ufffd (30s)'])
      expect(w.posts).toHaveLength(1)
      const controls = /[\u0000-\u001f\u007f-\u009f]/
      const shown = [...w.toasts, ...w.posts.flatMap(p => [p.headers?.Title ?? '', p.body ?? ''])]
      for (const text of shown) expect(controls.test(text), JSON.stringify(text)).toBe(false)
      expect(w.posts[0]?.body).toBe('A turn finished after 30s.')
      expect(JSON.stringify(w.posts)).not.toContain('login')
    },
  )

  test('a failing player never breaks the turn or the next alert', async ($, on) => {
    const w = world(on, { options: { play: 'fails' } })
    await start($, w)
    expect(await endTurn($, w, 30_000)).toMatchObject({ text: BENEATH })
    expect(w.toasts).toEqual(['Done - my-app (30s)'])
    expect(w.logs.some(l => l.to === 'debug' && l.text.includes('could not play done'))).toBe(true)
    await w.clock.advance(SIX_S)
    await notify($, w)
    expect(w.toasts).toHaveLength(2)
  })
})

describe('mute and quiet hours', () => {
  test('mute silences sounds for its duration; toasts still show', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'mute 30m')).toBe(
      'Muted for 30m, until 12:30. Toasts still show. /pager unmute ends it early.',
    )
    await endTurn($, w, 30_000)
    await notify($, w)
    expect(w.plays).toEqual([])
    expect(w.toasts).toHaveLength(2)

    await w.clock.advance(29 * 60_000)
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual([])

    await w.clock.advance(60_000) // 12:30, the mute is over
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
  })

  test('a mute silences the phone push too', { options: { ntfyTopic: 'pager-test' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    await pager($, w, 'mute 30m')
    await endTurn($, w, 30_000)
    await notify($, w)
    expect(w.toasts).toHaveLength(2)
    expect(w.posts).toEqual([])
    await pager($, w, 'unmute')
    await endTurn($, w, 31_000)
    expect(w.posts.map(p => p.url)).toEqual(['https://ntfy.sh/pager-test'])
  })

  test('a mute length may be typed with spaces', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'mute 1h 30m')).toContain('Muted for 1h 30m, until 13:30.')
  })

  test('unmute ends a mute early', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'unmute')).toBe('Not muted: sounds are on.')
    await pager($, w, 'mute 2h')
    expect(await pager($, w, 'unmute')).toBe('Unmuted. Sounds are back on.')
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
  })

  test('mute with no length means an hour; a length it cannot read changes nothing', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'mute soon')).toContain('Could not read "soon" as a duration')
    expect(await pager($, w, 'mute 8d')).toContain('Could not read')
    await endTurn($, w, 30_000)
    expect(w.plays).toHaveLength(1)

    expect(await pager($, w, 'mute')).toContain('Muted for 1h, until 13:00')
    await w.clock.advance(SIX_S)
    await endTurn($, w, 30_000)
    expect(w.plays).toHaveLength(1)
  })

  test(
    'quiet hours silence sound and push overnight, wrapping midnight',
    { options: { quietHours: '22:00-07:00', ntfyTopic: 'pager-test' } },
    async ($, on) => {
      const w = world(on, { options: { now: new Date(2026, 0, 5, 23, 30).getTime() } })
      await start($, w)
      await endTurn($, w, 30_000)
      expect(w.plays).toEqual([])
      expect(w.posts).toEqual([])
      expect(w.toasts).toHaveLength(1)

      await w.clock.set(new Date(2026, 0, 6, 6, 59).getTime())
      await notify($, w)
      expect(w.plays).toEqual([])

      await w.clock.set(new Date(2026, 0, 6, 7, 0).getTime())
      await endTurn($, w, 30_000)
      expect(w.plays).toEqual(['sounds/classic/done.wav'])
      expect(w.posts).toHaveLength(1)
    },
  )

  test('a quietHours setting it cannot read is said once at start and ignored', { options: { quietHours: '10pm-7am' } }, async ($, on) => {
    const w = world(on, { options: { now: new Date(2026, 0, 5, 23, 30).getTime() } })
    await start($, w)
    expect(w.logs.filter(l => l.text.includes('quietHours "10pm-7am" is not like 22:00-07:00'))).toHaveLength(1)
    await endTurn($, w, 30_000)
    expect(w.plays).toHaveLength(1)
  })
})

describe('commands', () => {
  test('/pager is registered at start, runnable mid-turn', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(w.commands).toEqual([{ name: 'pager', immediate: true }])
  })

  test('pack switches the clips; an unknown pack changes nothing', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'pack Arcade')).toBe('Pack set to arcade. Run /pager test to hear it.')
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/arcade/done.wav'])

    expect(await pager($, w, 'pack disco')).toBe('No pack called "disco". Packs: classic, arcade, zen.')
    expect(await pager($, w, 'pack')).toBe('Pack: arcade. Packs: classic, arcade, zen.')
  })

  test('test plays the three clips of the current pack in order, even while muted', async ($, on) => {
    const w = world(on)
    await start($, w)
    await pager($, w, 'pack zen')
    await pager($, w, 'mute 1h')
    const text = await pager($, w, 'test')
    expect(w.plays).toEqual(['sounds/zen/done.wav', 'sounds/zen/needs-you.wav', 'sounds/zen/error.wav'])
    expect(w.overlapped(), 'clips played on top of each other').toBe(false)
    expect(text).toContain('Played the zen pack: done, needs you, error.')
    expect(text).toContain('Real alerts are silent now (muted until 13:00).')
    expect(w.posts).toEqual([])
  })

  test('test says which clips failed instead of failing silently', async ($, on) => {
    const w = world(on, { options: { play: 'fails' } })
    await start($, w)
    const text = await pager($, w, 'test')
    expect(text).toContain('Played the classic pack, but 3 of 3 failed: Done: $.audio.play: no device;')
    expect(text).toContain('Heard nothing?')
  })

  test('only the person can mute, unmute, switch or test; status is open', async ($, on) => {
    const w = world(on)
    await start($, w)
    const strangers: PromptOrigin[] = [
      { kind: 'peer' },
      { kind: 'channel', server: 'slack' },
      { kind: 'plugin', name: 'other', asUser: true },
      { kind: 'task-notification' },
      { kind: 'unclassified' },
    ]
    for (const origin of strangers) {
      for (const args of ['mute 7d', 'pack zen', 'unmute', 'test']) {
        expect(await pager($, w, args, origin), `${origin.kind} ${args}`).toContain('only runs when you type it')
      }
      expect(await pager($, w, '', origin)).toContain('classic pack, sounds on.')
    }
    expect(w.plays).toEqual([]) // no test clips played for a stranger
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav']) // not muted, pack unchanged

    // The desktop app's prompts arrive as sdk, Remote Control as bridge: both are the person.
    expect(await pager($, w, 'pack zen', { kind: 'sdk' })).toBe('Pack set to zen. Run /pager test to hear it.')
    expect(await pager($, w, 'mute 10m', { kind: 'bridge' })).toContain('Muted for 10m')
  })

  test('echoed arguments are cleaned', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'pack \u001b[31mzen\u0007')).toBe('No pack called "zen\ufffd". Packs: classic, arcade, zen.')
  })

  test('status and an unknown subcommand', async ($, on) => {
    const w = world(on)
    await start($, w)
    const text = await pager($, w, '')
    expect(text).toContain('classic pack, sounds on.')
    expect(text).toContain('Done pages after turns of 20s or more. Quiet hours: off. Phone push: off.')
    expect(await pager($, w, 'shout')).toContain('Unknown: "shout".')
  })
})

describe('phone push', () => {
  test('no ntfyTopic: not one network call, whatever happens', async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 30_000)
    await w.clock.advance(SIX_S)
    await notify($, w)
    await w.clock.advance(SIX_S)
    await endTurn($, w, 1_000, 'error')
    await pager($, w, 'test')
    await pager($, w, '')
    expect(w.plays).toHaveLength(6)
    expect(w.posts).toEqual([])
  })

  test(
    'ntfyTopic: exactly one POST per alert, with no conversation content',
    { options: { ntfyTopic: 'pager-test-123' } },
    async ($, on) => {
      const w = world(on)
      await start($, w)
      await $.classic.UserPromptSubmit({ prompt: SECRET_PROMPT, session_title: 'Rotate prod-db password' })
      await endTurn($, w, 125_000)
      expect(w.posts).toEqual([
        {
          url: 'https://ntfy.sh/pager-test-123',
          method: 'POST',
          headers: { Title: 'Pager: done' },
          body: 'A turn finished after 2m 5s.',
        },
      ])

      await w.clock.advance(SIX_S)
      await notify($, w)
      await w.clock.advance(1_000)
      await endTurn($, w, 1_000, 'error') // inside the 5 s gap: no sound, no push
      expect(w.posts.map(p => p.headers?.Title)).toEqual(['Pager: done', 'Pager: needs you'])

      const sent = JSON.stringify(w.posts)
      for (const secret of [SECRET_PROMPT, SECRET_ANSWER, 'prod-db', 'hunter2', 'swordfish', 'my-app', 'Rotate']) {
        expect(sent).not.toContain(secret)
      }
    },
  )

  test('a pasted ntfy.sh URL is taken as its topic', { options: { ntfyTopic: 'https://ntfy.sh/abc' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 30_000)
    expect(w.posts.map(p => p.url)).toEqual(['https://ntfy.sh/abc'])
  })

  test('an invalid topic sends nothing and says so once', { options: { ntfyTopic: 'bad/topic?x=1' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    await endTurn($, w, 30_000)
    expect(w.posts).toEqual([])
    expect(w.plays).toHaveLength(1)
    const said = w.logs.filter(l => l.text.includes('ntfyTopic must be'))
    expect(said).toHaveLength(1)
    expect(said[0]?.text).not.toContain('bad/topic')
    expect(await pager($, w, '')).toContain('Phone push: off (the topic setting is not valid).')
  })

  test('a failed push never stops the sound', { options: { ntfyTopic: 'pager-test' } }, async ($, on) => {
    const w = world(on, { options: { fetch: 'fails' } })
    await start($, w)
    await endTurn($, w, 30_000)
    expect(w.plays).toEqual(['sounds/classic/done.wav'])
    expect(w.logs.some(l => l.to === 'debug' && l.text.includes('ntfy.sh push failed'))).toBe(true)
  })
})

describe('untrusted text everywhere it is shown (gotcha #31)', () => {
  const NASTY = 'a\u0007\u001b[31mb\u007f\u0000\u009bc'
  const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/

  test(
    'echoed arguments, a stranger refusal, a player error and a bad quietHours setting are all cleaned',
    { options: { quietHours: NASTY } },
    async ($, on) => {
      const w = world(on, { options: { play: 'fails', playError: NASTY } })
      await start($, w)
      const shown = [
        await pager($, w, `mute ${NASTY}`),
        await pager($, w, NASTY),
        await pager($, w, `pack ${NASTY}`),
        await pager($, w, NASTY, { kind: 'peer' }),
        await pager($, w, 'test'),
        ...w.logs.filter(l => l.to !== 'debug').map(l => l.text),
      ]
      expect(shown.some(t => t.includes('quietHours "a'))).toBe(true)
      expect(shown.some(t => t.includes('Done: $.audio.play: a'))).toBe(true)
      for (const text of shown) expect(CONTROLS.test(text), JSON.stringify(text)).toBe(false)
    },
  )

  test('a quietHours setting typed with tabs is shown in its plain form', { options: { quietHours: '22:00\t-\t07:00' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, '')).toContain('Quiet hours: 22:00-07:00.')
  })
})

describe('commands never push', () => {
  test('with a topic set, no /pager command sends anything', { options: { ntfyTopic: 'pager-test' } }, async ($, on) => {
    const w = world(on)
    await start($, w)
    for (const args of ['test', '', 'mute 5m', 'unmute', 'pack zen', 'status', 'nonsense']) await pager($, w, args)
    expect(w.plays).toHaveLength(3)
    expect(w.posts).toEqual([])
  })
})
