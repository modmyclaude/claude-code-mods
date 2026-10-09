// Untrusted text (the model's command, file names, branch names, commit
// subjects) made safe to draw. The engine refuses a whole tree holding a C0
// or C1 control character and draws its own instead, which would hide the
// hold and its Cancel button, so every such text goes through here first.

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b\[[0-?]*[ -/]*[@-~]|\x9b[0-?]*[ -/]*[@-~]|\x1b[ -/]*[0-~]?/g
const CONTROL = /[\x00-\x1f\x7f-\x9f]/g

/** One drawable line: ANSI sequences gone, line breaks and tabs as spaces, other controls as U+FFFD. */
export function clean(text: string): string {
  return text
    .replace(ANSI, '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(CONTROL, '�')
}
