// The pure parts: reading records, the states a reader infers, the rows' order
// and folding, the toasts' once-per-change rule, titles, and the words.

import { describe, expect, test } from 'claude-code/testing'

import {
  HEARTBEAT_MS, QUIET_MS, SHOWN_GONE_MS, STALE_MS, ageWords, bandLine, costWords, folderName, footerLabel, hereLine, heroLine,
  liveState, newlyNeeding, parseRecord, quietLine, rowsOf, seenOf, stateWords, titleFromTail, toastLine, transcriptPath, waitingWords,
} from '../hooks/board'
import type { SessionRecord } from '../hooks/board'

const NOW = 100_000_000
const rec = (id: string, name: string, state: SessionRecord['state'], ago = 0, more: Partial<SessionRecord> = {}): SessionRecord => ({
  v: 1, id, name, state, since: NOW - ago, updatedAt: NOW, where: 'terminal', lastActiveAt: NOW - ago, ...more,
})

describe('records', () => {
  test('a record is read only when it is whole and of this version; unknown extras are dropped', () => {
    const good = rec('a', 'api', 'needs-you', 0, { where: 'desktop', waitingOn: 'a question' })
    expect(parseRecord(JSON.stringify({ ...good, costUsd: 1.5 }))).toEqual({ ...good, costUsd: 1.5 })
    expect(parseRecord('{"v":1,"id":"a","na')).toBeNull() // half written
    expect(parseRecord(JSON.stringify({ ...good, v: 2 }))).toBeNull()
    expect(parseRecord(JSON.stringify({ ...good, state: 'dancing' }))).toBeNull()
    expect(parseRecord(JSON.stringify({ ...good, where: 'mars' }))?.where).toBeUndefined()
    expect(parseRecord(JSON.stringify({ ...good, costUsd: -3 }))?.costUsd).toBeUndefined()
    expect(parseRecord('null')).toBeNull()
  })

  test('a record not rewritten for three heartbeats belongs to a session that is gone (a closed tab within 90 s)', () => {
    expect(STALE_MS).toBe(3 * HEARTBEAT_MS)
    expect(STALE_MS).toBe(90_000)
    expect(liveState(rec('a', 'api', 'needs-you', 0, { updatedAt: NOW - STALE_MS }), NOW)).toBe('needs-you')
    expect(liveState(rec('a', 'api', 'needs-you', 0, { updatedAt: NOW - STALE_MS - 1 }), NOW)).toBe('gone')
  })
})

describe('rows', () => {
  test('who needs you first, then working, idle, quiet and gone; the latest change first in each', () => {
    const rows = rowsOf(
      [
        rec('me', 'api-server', 'idle', 5 * 60_000),
        rec('b', 'docs', 'working', 60_000),
        rec('c', 'site', 'needs-you', 30_000),
        rec('d', 'old', 'idle', 0, { updatedAt: NOW - STALE_MS - 1 }),
        rec('e', 'tests', 'error', 10_000),
        rec('f', 'web', 'idle', 60_000),
        rec('g', 'stale chat', 'idle', 10_000, { lastActiveAt: undefined }),
      ],
      'me',
      NOW,
    )
    expect(rows.map(r => `${r.name}:${r.state}${r.isQuiet ? ':quiet' : ''}${r.isMine ? ':mine' : ''}`)).toEqual([
      'site:needs-you', 'tests:error', 'docs:working', 'web:idle', 'api-server:idle:mine', 'stale chat:idle:quiet', 'old:gone',
    ])
  })

  test('an idle session is quiet with no turn since Switchboard loaded, or none in the last hour; this one never is', () => {
    const rows = rowsOf(
      [rec('a', 'fresh', 'idle', 0, { lastActiveAt: NOW - QUIET_MS }), rec('b', 'old', 'idle', 0, { lastActiveAt: NOW - QUIET_MS - 1 }), rec('me', 'me', 'idle', 0, { lastActiveAt: undefined })],
      'me',
      NOW,
    )
    expect(Object.fromEntries(rows.map(r => [r.name, r.isQuiet]))).toEqual({ fresh: false, old: true, me: false })
  })

  test('a gone session drops off after an hour; this one never does', () => {
    const rows = rowsOf([rec('me', 'api', 'idle', 0, { updatedAt: NOW - SHOWN_GONE_MS - STALE_MS }), rec('x', 'old', 'idle', 0, { updatedAt: NOW - SHOWN_GONE_MS - 1 })], 'me', NOW)
    expect(rows.map(r => r.id)).toEqual(['me'])
  })

  test('two sessions with one name get a short id each; names are cleaned to one line', () => {
    const rows = rowsOf([rec('1234abcd', 'api', 'idle'), rec('5678efgh', 'api', 'working'), rec('z', 'bad\u001b[2J\nname', 'idle')], 'z', NOW)
    expect(rows.map(r => r.name).sort()).toEqual(['api · 1234', 'api · 5678', 'bad [2J name'])
  })

  test('what a dialog waits on shows only while it waits', () => {
    const [row] = rowsOf([rec('a', 'api', 'working', 0, { waitingOn: 'a question' })], 'me', NOW)
    expect(row?.waitingOn).toBeUndefined()
  })
})

describe('toasts, once per change', () => {
  test('the first read raises none; a new "needs you" in another session raises one; a repeat raises none', () => {
    const first = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you')], 'me', NOW)
    expect(newlyNeeding(first, undefined)).toEqual([])
    const seen = seenOf(first)
    expect(newlyNeeding(first, seen)).toEqual([])
    const later = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you'), rec('c', 'site', 'error')], 'me', NOW)
    expect(newlyNeeding(later, seen).map(r => r.name)).toEqual(['site'])
    const again = rowsOf([rec('b', 'docs', 'needs-you', -5)], 'me', NOW)
    expect(newlyNeeding(again, seenOf(later)).map(r => r.name)).toEqual(['docs'])
  })
})

describe('words', () => {
  test('what a dialog waits on, in plain words', () => {
    expect(waitingWords('permission_prompt', 'Bash')).toBe('a permission for Bash')
    expect(waitingWords('permission_prompt', 'mcp__github__create_issue')).toBe('a permission for create_issue')
    expect(waitingWords('permission_prompt', 'AskUserQuestion')).toBe('a question')
    expect(waitingWords('permission_prompt', 'ExitPlanMode')).toBe('a plan to approve')
    expect(waitingWords('permission_prompt', undefined)).toBe('a permission')
    expect(waitingWords('elicitation_dialog', 'Bash')).toBe('an answer')
  })

  test('each state explains itself', () => {
    const at = (state: SessionRecord['state'], ago: number, more: Partial<SessionRecord> = {}) => {
      const [row] = rowsOf([rec('a', 'x', state, ago, more)], 'me', NOW)
      return stateWords(row!, NOW)
    }
    expect(at('needs-you', 2 * 60_000, { waitingOn: 'a permission for Bash' })).toBe('waiting on a permission for Bash · 2m')
    expect(at('working', 30_000)).toBe('working for under a minute')
    expect(at('idle', 9 * 60_000)).toBe('idle for 9m')
    expect(at('error', 5 * 60_000)).toBe('stopped on an error 5m ago')
    expect(at('gone', 2 * 60_000)).toBe('closed 2m ago')
    expect(at('gone', 1000)).toBe('closed just now')
  })

  test('lines for the pane, the band, the footer and the toasts', () => {
    const calm = rowsOf([rec('me', 'api', 'working'), rec('b', 'docs', 'idle')], 'me', NOW)
    expect(heroLine(calm)).toEqual({ text: 'Nothing needs you · 1 other session', tone: 'success' })
    expect(heroLine(rowsOf([rec('me', 'api', 'idle')], 'me', NOW))).toEqual({ text: 'Only this session', tone: 'subtle' })
    expect(hereLine(rowsOf([rec('me', 'Fix the login', 'idle', 0, { where: 'desktop' })], 'me', NOW))).toBe('You are here: Fix the login (desktop)')
    expect(bandLine(calm)).toBeNull()
    expect(footerLabel(calm)).toBeNull()
    const one = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you', 0, { where: 'desktop' })], 'me', NOW)
    expect(heroLine(one).text).toBe('1 needs you') // this session's own dialog is in front of you already
    expect(bandLine(one)).toBe('docs needs you (desktop)')
    expect(footerLabel(one)).toBe('1 needs you')
    expect(bandLine(rowsOf([rec('c', 'site', 'error')], 'me', NOW))).toBe('site stopped on an error (terminal)')
    const three = rowsOf([rec('b', 'docs', 'needs-you', 1), rec('c', 'site', 'needs-you', 2), rec('d', 'web', 'error', 3)], 'me', NOW)
    expect(bandLine(three)).toBe('3 sessions need you: docs, site, …')
    expect(footerLabel(three)).toBe('3 need you')
    expect(toastLine(three[0]!)).toBe('docs needs you (terminal).')
    expect(toastLine(three[2]!)).toBe('web stopped on an error (terminal).')
    expect(quietLine(1)).toBe('1 quiet session: idle, no turn in the last hour')
  })

  test('ages, costs and folder names', () => {
    expect([5_000, 59_999, 12 * 60_000, 3 * 3_600_000, 2 * 86_400_000].map(ageWords)).toEqual(['under a minute', 'under a minute', '12m', '3h', '2d'])
    expect([undefined, 0.004, 0.494, 4.1, 123.4].map(costWords)).toEqual(['', '', '≈$0.49', '≈$4.10', '≈$123'])
    expect(folderName('/work/api-server/')).toBe('api-server')
    expect(folderName('C:\\work\\site')).toBe('site')
  })
})

describe('titles', () => {
  test('the title the person set wins over the one Claude Code wrote; nothing else of the transcript is read', () => {
    const line = (o: object) => JSON.stringify(o)
    const tail = [
      'cut mid-line"}',
      line({ type: 'ai-title', aiTitle: 'NPM test run' }),
      line({ type: 'user', message: { content: 'please fix "type":"custom-title" in my code' } }),
      line({ type: 'custom-title', customTitle: 'Switchboard' }),
      line({ type: 'ai-title', aiTitle: 'Later summary' }),
    ].join('\n')
    expect(titleFromTail(tail)).toBe('Switchboard')
    expect(titleFromTail([line({ type: 'ai-title', aiTitle: 'NPM test run' })].join('\n'))).toBe('NPM test run')
    expect(titleFromTail(line({ type: 'custom-title', customTitle: 'bad\u001b[2Jtitle' }))).toBe('bad [2Jtitle')
    expect(titleFromTail('no titles here')).toBeUndefined()
  })

  test('a transcript lives under projects/, its folder the working directory with every other character as "-"', () => {
    expect(transcriptPath('/home/me/.claude', '/Users/me/lovable/personal', 'abc')).toBe('/home/me/.claude/projects/-Users-me-lovable-personal/abc.jsonl')
    expect(transcriptPath('/c', '/Users/me/.claude', 'x')).toBe('/c/projects/-Users-me--claude/x.jsonl')
  })
})
