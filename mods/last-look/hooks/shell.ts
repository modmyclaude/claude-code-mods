// A small, forgiving shell parser: just enough of bash's grammar to see which
// commands a string runs, with which words and redirects, in which order.
//
// It never throws and always ends: on input bash would reject (an open quote,
// a stray paren) it keeps going with its best reading, because a guard that
// stops at a parse error would let the rest of the string through unread.

/** One piece of a word, as written. */
export type Part =
  | { t: 'lit'; s: string; quoted: boolean }
  /** `quoted`: inside double quotes, so the shell neither splits nor globs its value. */
  | { t: 'var'; name: string; quoted: boolean }
  /** `$( ... )`, backticks or `<( ... )`: a command of its own. */
  | { t: 'sub'; src: string }
  /** An expansion nobody can know ahead (`$1`, `$((n+1))`, `${x:-y}`). */
  | { t: 'opaque' }

export type RawWord = { parts: Part[]; start: number; end: number }

export type Redir = {
  op: string
  fd?: string
  /** The file it names; absent for a here-doc or a descriptor copy (`2>&1`). */
  target?: RawWord
}

export type Simple = {
  kind: 'simple'
  words: RawWord[]
  redirs: Redir[]
  start: number
  end: number
}

export type Group = {
  kind: 'group'
  /** `( ... )` runs in a subshell; `{ ...; }` does not, so its `cd` sticks. */
  subshell: boolean
  body: Seq
  redirs: Redir[]
  start: number
  end: number
}

/** A command and the operator after it: `&&`, `||`, `;`, `|`, `&`, or ``. */
export type Item = (Simple | Group) & { op: string }
export type Seq = Item[]

const BLANK = new Set([' ', '\t', '\r'])
const ENDS_WORD = new Set([' ', '\t', '\r', '\n', ';', '&', '|', '(', ')', '<', '>'])
const REDIRECT = /^(\d*)(&>>|&>|>>|>\||>&|<<<|<<-|<<|<>|<&|>|<)/

export function parse(src: string): Seq {
  return new Parser(src).seq(false)
}

class Parser {
  private i = 0
  private heredocs: { delim: string; strip: boolean }[] = []

  constructor(private readonly src: string) {}

  seq(close: ')' | '}' | false): Seq {
    const items: Seq = []
    while (true) {
      this.blank()
      if (this.i >= this.src.length) return items
      const c = this.src[this.i]
      if (c === '\n') {
        this.newline()
        continue
      }
      if (c === ')') {
        this.i++
        if (close === ')') return items
        continue
      }
      if (c === ';' || c === '&' || c === '|') {
        this.i++
        continue
      }
      if (close === '}' && this.atWord('}')) {
        this.i++
        return items
      }
      const node = this.command()
      this.blank()
      items.push({ ...node, op: this.operator() })
    }
  }

  private command(): Simple | Group {
    const start = this.i
    if (this.src.startsWith('((', this.i)) {
      // Arithmetic `(( n > 2 ))`: its `>` compares, it redirects nothing.
      this.i = this.balanced(this.i)
      return { kind: 'simple', words: [], redirs: [], start, end: this.i }
    }
    if (this.src[this.i] === '(') {
      this.i++
      const body = this.seq(')')
      return { kind: 'group', subshell: true, body, redirs: this.redirects(), start, end: this.i }
    }
    if (this.atWord('{')) {
      this.i++
      const body = this.seq('}')
      return { kind: 'group', subshell: false, body, redirs: this.redirects(), start, end: this.i }
    }
    return this.simple()
  }

  private simple(): Simple {
    const start = this.i
    const words: RawWord[] = []
    const redirs: Redir[] = []
    while (true) {
      this.blank()
      const c = this.src[this.i]
      if (c === undefined || c === '\n' || c === ';' || c === '|' || c === ')' || c === '(') break
      if (c === '&' && this.src[this.i + 1] !== '>') break
      if ((c === '<' || c === '>') && this.src[this.i + 1] === '(') {
        words.push(this.processSub())
        continue
      }
      const redir = this.redirect()
      if (redir) {
        redirs.push(redir)
        continue
      }
      const before = this.i
      const word = this.word()
      if (this.i === before) {
        this.i++
        continue
      }
      words.push(word)
    }
    return { kind: 'simple', words, redirs, start, end: this.i }
  }

  /** Redirects after a group's closing paren or brace. */
  private redirects(): Redir[] {
    const out: Redir[] = []
    while (true) {
      this.blank()
      const redir = this.redirect()
      if (!redir) return out
      out.push(redir)
    }
  }

  private redirect(): Redir | undefined {
    const m = REDIRECT.exec(this.src.slice(this.i, this.i + 8))
    if (!m) return undefined
    const fd = m[1] === '' ? undefined : m[1]
    const op = m[2] ?? ''
    this.i += m[0].length
    this.blank()
    if (op === '<<' || op === '<<-') {
      const delim = this.word()
      this.heredocs.push({ delim: literal(delim), strip: op === '<<-' })
      return { op, fd }
    }
    const target = this.word()
    if ((op === '>&' || op === '<&') && /^(\d+|-)$/.test(literal(target))) return { op, fd }
    return { op, fd, target }
  }

  private operator(): string {
    const two = this.src.slice(this.i, this.i + 2)
    if (two === '&&' || two === '||' || two === '|&' || two === ';;') {
      this.i += 2
      return two === ';;' ? ';' : two
    }
    const c = this.src[this.i]
    if (c === ';' || c === '|' || c === '&') {
      this.i++
      return c
    }
    if (c === '\n') {
      this.newline()
      return ';'
    }
    return ''
  }

  /** Is the next word exactly `w`, unquoted and standing alone? */
  private atWord(w: string): boolean {
    if (!this.src.startsWith(w, this.i)) return false
    const after = this.src[this.i + w.length]
    return after === undefined || ENDS_WORD.has(after)
  }

  /** Spaces, tabs, line continuations and comments; never a newline. */
  private blank(): void {
    while (this.i < this.src.length) {
      const c = this.src[this.i]
      if (c !== undefined && BLANK.has(c)) this.i++
      else if (c === '\\' && this.src[this.i + 1] === '\n') this.i += 2
      else if (c === '#') {
        while (this.i < this.src.length && this.src[this.i] !== '\n') this.i++
      } else return
    }
  }

  /** Consumes a newline, then the bodies of any here-docs opened on its line. */
  private newline(): void {
    this.i++
    for (const doc of this.heredocs) {
      while (this.i < this.src.length) {
        const cut = this.src.indexOf('\n', this.i)
        const lineEnd = cut === -1 ? this.src.length : cut
        const line = this.src.slice(this.i, lineEnd)
        this.i = lineEnd + 1
        if ((doc.strip ? line.replace(/^\t+/, '') : line) === doc.delim) break
      }
    }
    this.heredocs = []
    if (this.i > this.src.length) this.i = this.src.length
  }

  private word(): RawWord {
    const start = this.i
    const parts: Part[] = []
    let lit = ''
    const flush = () => {
      if (lit !== '') parts.push({ t: 'lit', s: lit, quoted: false })
      lit = ''
    }
    while (this.i < this.src.length) {
      const c = this.src[this.i] ?? ''
      if (ENDS_WORD.has(c)) break
      if (c === '\\') {
        const next = this.src[this.i + 1]
        this.i += 2
        if (next === undefined || next === '\n') continue
        flush()
        parts.push({ t: 'lit', s: next, quoted: true })
      } else if (c === "'") {
        flush()
        const close = this.src.indexOf("'", this.i + 1)
        const end = close === -1 ? this.src.length : close
        parts.push({ t: 'lit', s: this.src.slice(this.i + 1, end), quoted: true })
        this.i = end + 1
      } else if (c === '"') {
        flush()
        this.i++
        this.doubleQuoted(parts)
      } else if (c === '$') {
        flush()
        this.dollar(parts, false)
      } else if (c === '`') {
        flush()
        parts.push({ t: 'sub', src: this.backtick() })
      } else {
        lit += c
        this.i++
      }
    }
    flush()
    if (this.i > this.src.length) this.i = this.src.length
    return { parts, start, end: this.i }
  }

  private doubleQuoted(parts: Part[]): void {
    let lit = ''
    const flush = () => {
      if (lit !== '') parts.push({ t: 'lit', s: lit, quoted: true })
      lit = ''
    }
    while (this.i < this.src.length) {
      const c = this.src[this.i] ?? ''
      if (c === '"') {
        this.i++
        break
      }
      if (c === '\\') {
        const next = this.src[this.i + 1] ?? ''
        if (next === '\n') this.i += 2
        else if ('$`"\\'.includes(next) && next !== '') {
          lit += next
          this.i += 2
        } else {
          lit += c
          this.i++
        }
      } else if (c === '$') {
        flush()
        this.dollar(parts, true)
      } else if (c === '`') {
        flush()
        parts.push({ t: 'sub', src: this.backtick() })
      } else {
        lit += c
        this.i++
      }
    }
    flush()
  }

  private dollar(parts: Part[], inQuotes: boolean): void {
    const next = this.src[this.i + 1] ?? ''
    if (next === '(') {
      if (this.src[this.i + 2] === '(') {
        this.i = this.balanced(this.i + 1)
        parts.push({ t: 'opaque' })
        return
      }
      const end = this.balanced(this.i + 1)
      parts.push({ t: 'sub', src: this.src.slice(this.i + 2, Math.max(this.i + 2, end - 1)) })
      this.i = end
    } else if (next === '{') {
      const close = this.src.indexOf('}', this.i + 2)
      const end = close === -1 ? this.src.length : close
      const inner = this.src.slice(this.i + 2, end)
      parts.push(/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner) ? { t: 'var', name: inner, quoted: inQuotes } : { t: 'opaque' })
      this.i = end + 1
    } else if (/[A-Za-z_]/.test(next)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.i + 1)) ?? ['']
      parts.push({ t: 'var', name: m[0], quoted: inQuotes })
      this.i += 1 + m[0].length
    } else if (/[0-9@*#?$!-]/.test(next) && next !== '') {
      parts.push({ t: 'opaque' })
      this.i += 2
    } else if (next === "'" && !inQuotes) {
      // $'...': ANSI-C quoting; the common escapes are enough here.
      let s = ''
      let j = this.i + 2
      while (j < this.src.length && this.src[j] !== "'") {
        if (this.src[j] === '\\' && j + 1 < this.src.length) {
          const e = this.src[j + 1] ?? ''
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e
          j += 2
        } else s += this.src[j++]
      }
      parts.push({ t: 'lit', s, quoted: true })
      this.i = j + 1
    } else if (next === '"' && !inQuotes) {
      this.i += 2
      this.doubleQuoted(parts)
    } else {
      parts.push({ t: 'lit', s: '$', quoted: inQuotes })
      this.i++
    }
  }

  /** From an opening paren at `open`, the index just past its partner. */
  private balanced(open: number): number {
    let depth = 0
    let j = open
    while (j < this.src.length) {
      const c = this.src[j]
      if (c === '\\') j += 2
      else if (c === "'") {
        const close = this.src.indexOf("'", j + 1)
        j = close === -1 ? this.src.length : close + 1
      } else if (c === '"') {
        j++
        while (j < this.src.length && this.src[j] !== '"') j += this.src[j] === '\\' ? 2 : 1
        j++
      } else if (c === '(') {
        depth++
        j++
      } else if (c === ')') {
        depth--
        j++
        if (depth === 0) return j
      } else j++
    }
    return this.src.length
  }

  private backtick(): string {
    let j = this.i + 1
    let s = ''
    while (j < this.src.length && this.src[j] !== '`') {
      if (this.src[j] === '\\' && j + 1 < this.src.length) {
        s += this.src[j + 1]
        j += 2
      } else s += this.src[j++]
    }
    this.i = j + 1
    return s
  }

  /** `<( ... )` or `>( ... )`: a command whose output stands in as a file. */
  private processSub(): RawWord {
    const start = this.i
    const end = this.balanced(this.i + 1)
    const src = this.src.slice(this.i + 2, Math.max(this.i + 2, end - 1))
    this.i = end
    return { parts: [{ t: 'sub', src }], start, end }
  }
}

/** A word's text when it holds no expansion; quotes removed. */
export function literal(w: RawWord): string {
  return w.parts.map(p => (p.t === 'lit' ? p.s : '')).join('')
}
