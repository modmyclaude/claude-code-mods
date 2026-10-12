// The pure parts: reading records, the states a reader infers, the rows' order,
// the toasts' once-per-change rule, and the words.

import { describe, expect, test } from 'claude-code/testing'

import {
  HEARTBEAT_MS, SHOWN_GONE_MS, STALE_MS, ageWords, bandLine, costWords, folderName, heroLine, liveState, newlyNeeding, parseRecord,
  rowsOf, seenOf, toastLine,
} from '../hooks/board'
import type { SessionRecord } from '../hooks/board'

const NOW = 10_000_000
const rec = (id: string, name: string, state: SessionRecord['state'], ago = 0, staleFor = 0): SessionRecord => ({
  v: 1, id, name, state, since: NOW - ago, updatedAt: NOW - staleFor,
})

describe('records', () => {
  test('a record is read only when it is whole and of this version', () => {
    const good = rec('a', 'api', 'idle')
    expect(parseRecord(JSON.stringify({ ...good, costUsd: 1.5 }))).toEqual({ ...good, costUsd: 1.5 })
    expect(parseRecord('{"v":1,"id":"a","na')).toBeNull() // half written
    expect(parseRecord(JSON.stringify({ ...good, v: 2 }))).toBeNull()
    expect(parseRecord(JSON.stringify({ ...good, state: 'dancing' }))).toBeNull()
    expect(parseRecord(JSON.stringify({ ...good, id: '' }))).toBeNull()
    expect(parseRecord(JSON.stringify({ ...good, costUsd: -3 }))).toEqual(good) // a bad cost is dropped, the row kept
    expect(parseRecord('null')).toBeNull()
  })

  test('a record not rewritten for three heartbeats belongs to a session that is gone', () => {
    expect(STALE_MS).toBe(3 * HEARTBEAT_MS)
    expect(liveState(rec('a', 'api', 'working', 0, STALE_MS), NOW)).toBe('working')
    expect(liveState(rec('a', 'api', 'working', 0, STALE_MS + 1), NOW)).toBe('gone')
  })
})

describe('rows', () => {
  test('who needs you first, then working, idle and gone; the latest change first in each', () => {
    const rows = rowsOf(
      [
        rec('me', 'api-server', 'idle', 5 * 60_000),
        rec('b', 'docs', 'working', 60_000),
        rec('c', 'site', 'needs-you', 30_000),
        rec('d', 'old', 'idle', 0, STALE_MS + 1),
        rec('e', 'tests', 'error', 10_000),
        rec('f', 'web', 'idle', 60_000),
      ],
      'me',
      NOW,
    )
    expect(rows.map(r => `${r.name}:${r.state}${r.isMine ? '*' : ''}`)).toEqual(['site:needs-you', 'tests:error', 'docs:working', 'web:idle', 'api-server:idle*', 'old:gone'])
  })

  test('a gone session drops off after an hour; this one never does', () => {
    const rows = rowsOf([rec('me', 'api', 'idle', 0, SHOWN_GONE_MS + STALE_MS), rec('x', 'old', 'idle', 0, SHOWN_GONE_MS + 1)], 'me', NOW)
    expect(rows.map(r => r.id)).toEqual(['me'])
  })

  test('two sessions with one name get a short id each; names are cleaned to one line', () => {
    const rows = rowsOf([rec('1234abcd', 'api', 'idle'), rec('5678efgh', 'api', 'working'), rec('z', 'bad\u001b[2J\nname', 'idle')], 'z', NOW)
    expect(rows.map(r => r.name).sort()).toEqual(['api 1234', 'api 5678', 'bad [2J name'])
  })

  test('the newest record of a session wins when two copies are read', () => {
    const rows = rowsOf([rec('a', 'api', 'idle', 0, 10_000), rec('a', 'api', 'working', 0, 1_000)], 'me', NOW)
    expect(rows.map(r => r.state)).toEqual(['working'])
  })
})

describe('toasts, once per change', () => {
  test('the first read raises none; a new "needs you" in another session raises one; a repeat raises none', () => {
    const first = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you')], 'me', NOW)
    expect(newlyNeeding(first, undefined)).toEqual([])
    const seen = seenOf(first)
    expect(newlyNeeding(first, seen)).toEqual([])
    const later = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you'), rec('c', 'site', 'error', 0)], 'me', NOW)
    expect(newlyNeeding(later, seen).map(r => r.name)).toEqual(['site'])
    // docs answered, then needs you again: a new change, a new toast.
    const again = rowsOf([rec('b', 'docs', 'needs-you', -5)], 'me', NOW + 5)
    expect(newlyNeeding(again, seenOf(later)).map(r => r.name)).toEqual(['docs'])
  })
})

describe('words', () => {
  test('lines for the pane, the band and the toasts', () => {
    const calm = rowsOf([rec('me', 'api', 'working'), rec('b', 'docs', 'idle')], 'me', NOW)
    expect(heroLine(calm)).toEqual({ text: 'Nothing needs you · 2 sessions', tone: 'success' })
    expect(heroLine(rowsOf([rec('me', 'api', 'idle')], 'me', NOW))).toEqual({ text: 'Only this session', tone: 'subtle' })
    expect(bandLine(calm)).toBeNull()
    const one = rowsOf([rec('me', 'api', 'needs-you'), rec('b', 'docs', 'needs-you')], 'me', NOW)
    expect(heroLine(one).text).toBe('1 of 2 needs you') // this session's own dialog is in front of you already
    expect(bandLine(one)).toBe('docs needs you')
    expect(bandLine(rowsOf([rec('c', 'site', 'error')], 'me', NOW))).toBe('site stopped on an error')
    const three = rowsOf([rec('b', 'docs', 'needs-you', 1), rec('c', 'site', 'needs-you', 2), rec('d', 'web', 'error', 3)], 'me', NOW)
    expect(bandLine(three)).toBe('3 sessions need you: docs, site, …')
    expect(toastLine(three[0]!)).toBe('docs needs you.')
    expect(toastLine(three[2]!)).toBe('web stopped on an error.')
  })

  test('ages, costs and folder names', () => {
    expect([5_000, 59_999, 12 * 60_000, 3 * 3_600_000, 2 * 86_400_000].map(ageWords)).toEqual(['now', 'now', '12m', '3h', '2d'])
    expect([undefined, 0.494, 4.1, 123.4].map(costWords)).toEqual(['', '≈$0.49', '≈$4.10', '≈$123'])
    expect(folderName('/work/api-server/')).toBe('api-server')
    expect(folderName('C:\\work\\site')).toBe('site')
  })
})
