// The corpus, through the real wiring: each text comes back from a Bash call
// and is appended to the conversation as a tool result, and what the model
// would read is checked. The pure detector gets the same table.

import { describe, expect, mock, test } from 'claude-code/testing'

import { detect } from '../hooks/detect'
import { HIDE, KEEP } from './corpus'
import { bash, runBash, start, stdoutOf, TICKET, world } from './world'

describe('the hide corpus', () => {
  test(`has at least 40 cases`, () => {
    expect(HIDE.length).toBeGreaterThanOrEqual(40)
  })

  test('every case is hidden in a Bash result the model reads', async ($, on) => {
    const w = world(on)
    await start($)
    for (const c of HIDE) {
      expect(c.text.includes(c.secret), `fixture "${c.label}" holds its secret`).toBe(true)
      w.answer.Bash = () => bash(`before\n${c.text}\nafter`)
      const ran = await runBash($, 'cat fixture')
      const seen = stdoutOf(ran)
      expect(seen.includes(c.secret), `${c.label}: the secret still shows in ${seen}`).toBe(false)
      expect(seen, c.label).toMatch(TICKET)
      expect(seen.startsWith('before\n') && seen.endsWith('\nafter'), `${c.label}: text around it kept`).toBe(true)
      // A fresh answer: no `ref` or `text` of core's to fall back on.
      expect(ran.ref, c.label).toBeUndefined()
      expect(ran.text, c.label).toBeUndefined()
    }
  })

  test('every case is hidden in a tool_result row stored in the transcript', async ($, on) => {
    world(on)
    const session = mock.session(on)
    await start($)
    let n = 0
    for (const c of HIDE) {
      await $.session.append({
        message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: `toolu_${n}`, content: c.text }] },
        door: 'tool-result',
        origin: { kind: 'tool', tool: 'Bash' },
        uuid: `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`,
      })
    }
    const rows = session.appended()
    expect(rows).toHaveLength(HIDE.length)
    rows.forEach((row, i) => {
      const stored = JSON.stringify(row.message.content)
      const c = HIDE[i]!
      expect(stored.includes(JSON.stringify(c.secret).slice(1, -1)), `${c.label}: stored ${stored}`).toBe(false)
      expect(stored, c.label).toMatch(TICKET)
    })
  })

  test('the pure detector finds every case on its own', () => {
    for (const c of HIDE) {
      const hits = detect(c.text)
      const at = c.text.indexOf(c.secret)
      const covered = hits.some(h => h.start <= at && h.end >= at + c.secret.length)
      expect(covered, `${c.label}: ${JSON.stringify(hits)}`).toBe(true)
    }
  })
})

describe('the keep corpus', () => {
  test('has at least 25 cases', () => {
    expect(KEEP.length).toBeGreaterThanOrEqual(25)
  })

  test('every case passes through a Bash result untouched', async ($, on) => {
    const w = world(on)
    await start($)
    for (const c of KEEP) {
      w.answer.Bash = () => bash(c.text)
      const ran = await runBash($, 'cat fixture')
      expect(stdoutOf(ran), c.label).toBe(c.text)
      // Clean results are relayed as core made them, its own text included.
      expect(ran.text, c.label).toBe(c.text)
    }
  })

  test('the pure detector finds nothing in any case', () => {
    for (const c of KEEP) expect(detect(c.text), c.label).toEqual([])
  })
})
