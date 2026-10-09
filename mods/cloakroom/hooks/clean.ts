// One gate for every untrusted string cloakroom draws or prints: the program
// and host in a held command, a revealed value, file names, previews.
//
// A drawn tree holding a control character is refused whole by the engine,
// and the band composes the bands beneath it, so one stray ESC would blank
// the hold (and every other mod's band) right when it matters. Bidi overrides
// and zero-width characters are dropped too: they can make a host read as
// another one.

const ANSI = [
  /\x1b\[[0-?]{0,64}[ -/]{0,16}[@-~]/g, // CSI: ESC [ ... final byte
  /\x9b[0-?]{0,64}[ -/]{0,16}[@-~]/g, // the same, as one C1 character
  /\x1b\][^\x07\x1b]{0,4096}(?:\x07|\x1b\\)/g, // OSC: ESC ] ... BEL or ST
  /\x1b[@-Z\\-_]/g, // two-character escapes
]
/** Bidi embeddings, overrides and isolates; zero-width spaces and joiners; BOM. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
/** C0 (all but newline here), DEL and C1. */
const CONTROL = /[\x00-\x09\x0b-\x1f\x7f-\x9f]/g

/**
 * The text with ANSI sequences removed, invisible direction and width marks
 * dropped, tabs as two spaces, and every other control character as U+FFFD.
 * Newlines are kept only when `keepNewlines` (a multi-line key, a list).
 */
export function clean(text: string, options: { keepNewlines?: boolean } = {}): string {
  let out = text.replace(/\r\n/g, '\n')
  for (const re of ANSI) out = out.replace(re, '')
  out = out.replace(INVISIBLE, '').replace(/\t/g, '  ')
  if (!options.keepNewlines) out = out.replace(/\n/g, ' ')
  return out.replace(CONTROL, '\uFFFD')
}
