// The pure parts: the tic list, counting, labels, the words.

import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_TICS, EM_DASH, NUDGE_TEXT, bandWords, clean, countReply, countsOf, labelOf, merge, rowsOf, scoreboardText, showOf, statusWords, ticsOf, total, worst } from '../hooks/jar'

describe('counting a reply', () => {
  test('whole phrases, any case, straight or curly apostrophes', () => {
    const { counts, hits } = countReply("You’re absolutely right! GREAT question. I apologize for the delay.", DEFAULT_TICS)
    expect(counts).toEqual({ 'absolutely right': 1, 'great question': 1, 'i apologize': 1 })
    expect(hits.map(h => h.label)).toEqual(['absolutely right', 'great question', 'i apologize'])
    expect(hits[0]).toEqual({ label: 'absolutely right', before: '', tic: "You're absolutely right", after: '!' })
  })

  test('a word inside another word is not a tic: delved and delves are not delve', () => {
    expect(countReply('We delved in and it delves deeper; let us delve.', DEFAULT_TICS).counts).toEqual({ delve: 1 })
  })

  test('every em dash counts, and nothing else does for it', () => {
    const text = `A${EM_DASH}B${EM_DASH}C${EM_DASH}D${EM_DASH}E`
    expect(countReply(text, DEFAULT_TICS).counts).toEqual({ 'em dashes': 4 })
  })

  test('the sentence around a hit is cut to the window and cleaned of control characters', () => {
    const long = `${'x'.repeat(100)} great question ${'y'.repeat(100)}.`
    const [hit] = countReply(long, DEFAULT_TICS).hits
    expect(hit?.before.startsWith('...')).toBe(true)
    expect(hit?.after.endsWith('...')).toBe(true)
    expect((hit?.before.length ?? 0) <= 75 && (hit?.after.length ?? 0) <= 75).toBe(true)
    const dirty = countReply('Great question\u001b[2J\u0007 indeed.', DEFAULT_TICS).hits[0]
    expect(dirty?.after).toBe('� indeed.')
  })

  test('both ways of saying it land in one jar', () => {
    expect(countReply('You are absolutely right. You\'re absolutely right.', DEFAULT_TICS).counts).toEqual({ 'absolutely right': 2 })
  })
})

describe('the list', () => {
  test('the setting replaces the built-in list; the words "em dash" mean the character; nothing left means the built-in list', () => {
    expect(ticsOf(['Synergy', 'em dash', 'synergy', ''])).toEqual(['synergy', EM_DASH])
    expect(ticsOf(['Em dashes'])).toEqual([EM_DASH])
    expect(ticsOf([])).toEqual([...DEFAULT_TICS])
    expect(ticsOf(undefined)).toEqual([...DEFAULT_TICS])
    expect(ticsOf([42, 'certainly!'])).toEqual(['certainly!'])
  })

  test('labels: the em dash by name, praise openers without their you\'re, no trailing bang', () => {
    expect(labelOf(EM_DASH)).toBe('em dashes')
    expect(labelOf("you're absolutely right")).toBe('absolutely right')
    expect(labelOf('you are absolutely right')).toBe('absolutely right')
    expect(labelOf('certainly!')).toBe('certainly')
    expect(labelOf('delve')).toBe('delve')
  })
})

describe('the words', () => {
  test('the band shows the top three by count, ties in the order the list names them', () => {
    const counts = { delve: 2, 'great question': 5, 'em dashes': 2, certainly: 1 }
    expect(rowsOf(counts).map(r => r.label)).toEqual(['great question', 'delve', 'em dashes', 'certainly'])
    expect(bandWords(counts)).toBe('swear-jar: great question 5 · delve 2 · em dashes 2')
    expect(statusWords(counts)).toBe('swear-jar 10')
    expect(total(counts)).toBe(10)
  })

  test('merging, the worst offender, and the store shape', () => {
    expect(merge({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 3, b: 1 })
    expect(worst({}, { delve: 1 })).toEqual({ label: 'delve', count: 1 })
    expect(worst({ certainly: 9 }, { delve: 1 })).toEqual({ label: 'certainly', count: 9 })
    expect(countsOf({ a: 2, b: -1, c: 'x', d: 1.7 })).toEqual({ a: 2, d: 1 })
    expect(countsOf(['a'])).toEqual({})
    expect(countsOf(null)).toEqual({})
  })

  test('the show setting and the plain-lines scoreboard', () => {
    expect(showOf(undefined)).toEqual({ band: true, status: false })
    expect(showOf('STATUS')).toEqual({ band: false, status: true })
    expect(showOf('both')).toEqual({ band: true, status: true })
    expect(showOf('off')).toEqual({ band: false, status: false })
    const text = scoreboardText({ delve: 1 }, { delve: 3 }, [{ label: 'delve', before: 'we ', tic: 'delve', after: ' in' }], true)
    expect(text.split('\n')).toEqual(['Swear jar: 1 this session, 3 all time', '  delve 1', 'Worst offender: delve (3)', 'Last reply: delve', 'Plain-words nudge on'])
    expect(clean('a\u001b[31mb\u0000c  d')).toBe('ab�c d')
    expect(NUDGE_TEXT.split(' ').length).toBeLessThan(25)
  })
})
