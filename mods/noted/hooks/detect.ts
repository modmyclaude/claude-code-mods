// The cheap gate: a keyword pre-filter that decides whether a prompt reads
// like a correction. Only prompts that pass it ever reach the model, so it
// errs toward recall on short, pointed messages and stays silent on the rest.
// Pure and synchronous: it runs on every prompt and must cost nothing.

/** Longer prompts are task descriptions, not corrections; skip them. */
export const MAX_PROMPT_CHARS = 800

// Openers people put in front of a correction ("ok, no - ...", "hey Claude,").
const FILLER =
  /^(?:(?:hey|hi|hmm+|um+|uh+|oh|ah|ugh|ok(?:ay)?|well|wait|sorry|so|actually|please|pls|plz|claude)\b[\s,.!:;]*)+/i

// A leading "no" that is a pleasantry, not a correction ("no worries").
const NO_PLEASANTRY =
  /^(?:worries|worry|problem|problems|prob|probs|thanks|thank|thx|rush|biggie|idea|clue|need|way|kidding|doubt|matter|offen[cs]e|pressure|stress|more|longer)\b/i

// "don't" / "do not" / "never" followed by these is an idiom or a feature
// name ("do not disturb mode", "never mind", "don't worry").
const NEGATION_IDIOM = /^(?:disturb|track|worry|know|mind|bother|forget\s+it)\b/i

// Patterns that must open a sentence (after filler).
const NO_OPENER = /^(?:no+|nope|nah)(?:[,.!;:]+\s*|\s+)(\S.*)$/is
const NEGATION_OPENER = /^(?:don'?t|dont|do\s+not|never)\s+(\S.*)$/is
const OPENERS: readonly RegExp[] = [
  /^always\s+\w/i,
  /^(?:stop|quit)\s+\w+ing\b/i,
  /^use\s+\S+\s+(?:not|instead\s+of|rather\s+than|over)\s+\S/i,
  /^instead\s+of\s+\S.*\buse\b/i,
  /^prefer\s+\S.*\b(?:over|to)\s+\S/i,
  /^(?:from\s+now\s+on|going\s+forward|in\s+(?:the\s+)?future)\b/i,
]

// Patterns that count anywhere in the prompt.
const ANYWHERE: readonly RegExp[] = [
  /\bi\s+(?:already\s+|just\s+)?(?:told|asked)\s+you\b/i,
  /\bas\s+i\s+(?:said|mentioned)\b/i,
  /\bi\s+said\s+(?:to|not)\b/i,
  /\bwe\s+(?:use|prefer|want)\s+\S+(?:\s+\S+)?\s+(?:not|instead\s+of|rather\s+than|over)\s+\S/i,
  /\bwe\s+(?:always|never|don'?t|do\s+not)\s+\w/i,
  /\byou\s+keep\s+\w+ing\b/i,
]

/** Prompt text with code fences and inline code removed, apostrophes plain. */
function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
}

/** Sentences with their end punctuation kept, so a question can be told. */
function sentences(text: string): string[] {
  return (text.match(/[^.!?;\n]+[.!?;]*/g) ?? []).map(s => s.trim()).filter(Boolean)
}

function opensWithCorrection(candidate: string): boolean {
  const s = candidate.replace(FILLER, '').trim()
  if (s === '') return false

  const no = NO_OPENER.exec(s)
  if (no) return !NO_PLEASANTRY.test(no[1] ?? '')

  // "Don't you think...?" and "Always?" are questions, not rules.
  const isQuestion = s.endsWith('?')
  const negation = NEGATION_OPENER.exec(s)
  if (negation) return !isQuestion && !NEGATION_IDIOM.test(negation[1] ?? '')

  return !isQuestion && OPENERS.some(re => re.test(s))
}

/**
 * True when the prompt reads like a correction worth turning into a rule:
 * "no, ...", "don't ...", "always ...", "we use X not Y", "stop doing ...",
 * "I told you ...". False for slash commands, shell escapes and long prompts.
 */
export function looksLikeCorrection(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed.length > MAX_PROMPT_CHARS) return false
  if (trimmed.startsWith('/') || trimmed.startsWith('!')) return false

  const clean = prose(trimmed)
  if (ANYWHERE.some(re => re.test(clean))) return true
  return [clean, ...sentences(clean)].some(opensWithCorrection)
}
