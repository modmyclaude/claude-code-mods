// The one cleaner every drawn title and stage name goes through. Control and
// invisible characters are built with String.fromCodePoint, so none sits in this file.

import { describe, expect, test } from 'claude-code/testing'

import { clean } from '../hooks/clean'
import { cleanText } from '../hooks/outline'

const ch = (code: number) => String.fromCodePoint(code)
const ESC = ch(0x1b)
const BEL = ch(0x07)
// Anything the engine refuses in drawn text: C0, DEL and C1.
const REFUSED = new RegExp('[\\x00-\\x1f\\x7f-\\x9f]')

describe('clean', () => {
  const cases: [string, string, string][] = [
    ['BEL', `a${BEL}b`, 'ab'],
    ['NUL', `a${ch(0x00)}b`, 'ab'],
    ['DEL', `a${ch(0x7f)}b`, 'ab'],
    ['a lone ESC before a space', `a${ESC} b`, 'a b'],
    ['a CSI colour sequence', `Fix ${ESC}[1;31mFAIL${ESC}[0m now`, 'Fix FAIL now'],
    ['an unfinished CSI at the end', `tail${ESC}[`, 'tail'],
    ['the one-byte CSI (U+009B)', `x${ch(0x9b)}1;31my`, 'xy'],
    ['a lone C1 control', `x${ch(0x90)}y`, 'xy'],
    ['a charset switch, as tput sgr0 prints', `${ESC}(B${ESC}[mplain`, 'plain'],
    ['an OSC 8 hyperlink keeps its text', `${ESC}]8;;https://example.test${ESC}\\docs${ESC}]8;;${ESC}\\`, 'docs'],
    ['an OSC window title ended by BEL', `${ESC}]0;title${BEL}rest`, 'rest'],
    ['tabs and line breaks read as spaces', `a\tb\nc${ch(0x85)}d`, 'a b c d'],
    ['bidi overrides and isolates', `abc${ch(0x202e)}def${ch(0x2066)}g${ch(0x2069)}`, 'abcdefg'],
    ['zero-width characters, the BOM and the soft hyphen', `a${ch(0x200b)}b${ch(0x200d)}c${ch(0xfeff)}d${ch(0xad)}e`, 'abcde'],
    ['plain text, accents, kana and the line marks pass untouched', 'Café ルート ▰▱ · …', 'Café ルート ▰▱ · …'],
  ]
  for (const [name, input, expected] of cases) test(name, () => expect(clean(input)).toBe(expected))

  test('no C0, DEL or C1 control survives, alone or in a sequence', () => {
    let every = ''
    for (let code = 0; code <= 0x9f; code += 1) if (code < 0x20 || code >= 0x7f) every += `${ch(code)}x`
    expect(REFUSED.test(clean(every))).toBe(false)
    expect(REFUSED.test(clean(`${ESC}[${ESC}]${ESC}P${ch(0x9d)}${ch(0x9b)}${ESC}`))).toBe(false)
  })

  test('cleanText cleans first, then strips markdown and collapses spaces', () => {
    expect(cleanText(`**Fix** ${ESC}[31m\`FAIL\`${ESC}[0m${BEL}  in the parser`)).toBe('Fix FAIL in the parser')
  })
})
