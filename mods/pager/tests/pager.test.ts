// Pager through the real wiring: turns end, notifications fire and commands
// run as the engine raises them; the test's hooks stand in for the player,
// the toast stack, the network and the clock beneath the plugin.

import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROOT = '/Users/someone/code/my-app'
const NOON = new Date(2026, 0, 5, 12, 0).getTime()
const SECRET_PROMPT = 'please rotate the prod-db password hunter2'
const SECRET_ANSWER = 'Rotated prod-db; new password is swordfish'

type Post = { url: string; method?: string; headers?: Record<string, string>; body?: string }

type World = {
  options?: { play?: 'ok' | 'fails'; fetch?: 'ok' | 'fails'; now?: number }
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

  on('audio.play', (_$, e) => {
    if (options.play === 'fails') return { deny: 'no device' }
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
  on('command.register', (_$, e) => {
    commands.push({ name: e.name, immediate: e.immediate })
    return { value: { command: e.name } }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('classic.Notification', () => ({}))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  return { clock, plays, toasts, logs, posts, commands }
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

async function pager($: Engine, w: W, args: string) {
  const { text = '' } = await $.command.run({
    command: 'pager',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  await w.clock.settle()
  return text
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

  test('the turn still ends with its own answer', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await endTurn($, w, 30_000)).toMatchObject({ text: SECRET_ANSWER })
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

  test('a failing player never breaks the turn or the next alert', async ($, on) => {
    const w = world(on, { options: { play: 'fails' } })
    await start($, w)
    expect(await endTurn($, w, 30_000)).toMatchObject({ text: SECRET_ANSWER })
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

  test('unmute ends a mute early', async ($, on) => {
    const w = world(on)
    await start($, w)
    expect(await pager($, w, 'unmute')).toBe('Pager was not muted.')
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

  test('status and an unknown subcommand', async ($, on) => {
    const w = world(on)
    await start($, w)
    const text = await pager($, w, '')
    expect(text).toContain('Pager: classic pack, sounds on.')
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
