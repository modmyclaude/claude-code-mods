// Untrusted text made safe. The engine refuses a whole drawn tree that holds
// a C0 or C1 control character and draws its own instead, hiding the band and
// every band beneath it. The model's rule, the rules read from CLAUDE.md files
// and anything quoted from the store are untrusted, so every drawn string goes
// through `clean`, and a rule goes through `stripControls` before it is written.

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]?/g
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g

/** One drawable line: ANSI sequences gone, breaks and tabs as spaces, other controls as U+FFFD. */
export function clean(text: string): string {
  return text.replace(ANSI, '').replace(/[\r\n\t]/g, ' ').replace(CONTROL, '�')
}

/**
 * Text fit to write into a file: ANSI sequences and control characters
 * removed, and U+FFFD too (noted refuses to edit a file that holds one).
 * Whitespace controls become spaces first, so words stay apart.
 */
export function stripControls(text: string): string {
  return text.replace(ANSI, '').replace(/[\r\n\t\v\f]/g, ' ').replace(CONTROL, '').replace(/�/g, '')
}
