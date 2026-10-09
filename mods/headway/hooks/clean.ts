// The one cleaner for text Headway draws that came from outside it: step
// titles and stage names out of Claude's todo, task and plan-mode tools.
// The engine refuses a drawn tree whose text holds a control character and
// draws its own instead, and since Headway wraps the band mods beneath it,
// one stray escape in a title would take their lines (and buttons) down too.

// ANSI escape sequences: CSI (ESC [ or its one-byte form U+009B) with its
// parameters, a terminated string (OSC, DCS, SOS, PM, APC; a hyperlink keeps
// its text), then any other ESC with the bytes that belong to it (a space
// after a stray ESC is kept as text).
const ANSI =
  /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]|(?:\u001b[\]PX^_]|[\u0090\u0098\u009d-\u009f])[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)|\u001b[!-/]*[0-~]?/g
// Line breaks and tabs read as a space (titles are one line).
const BREAKS = /[\t\n\v\f\r\u0085\u2028\u2029]/g
// Every other C0 control, DEL and every C1 control.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g
// Invisible marks that can reorder or hide text: bidi embeddings, overrides
// and isolates, zero-width characters, word joiners, the BOM, soft hyphens.
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

/** Text safe to draw: escape sequences gone, breaks as spaces, controls and invisible marks removed. */
export function clean(text: string): string {
  return text.replace(ANSI, '').replace(BREAKS, ' ').replace(CONTROLS, '').replace(INVISIBLE, '')
}
