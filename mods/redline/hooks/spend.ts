// Where the money went: which kind of work a model request carried. A request's
// input holds the results of the previous response's tool calls in the same loop,
// so each request is charged to the kinds of those tools, read off the response
// stream redline already watches; the first request of a turn carries the prompt,
// a subagent's requests are one kind. Nothing is guessed from the transcript.

/** The kinds, as the pane labels their rows. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  prompt: 'Prompt',
  reading: 'Reading',
  editing: 'Editing',
  shell: 'Shell',
  search: 'Search',
  planning: 'Planning',
  subagents: 'Subagents',
  answering: 'Answering',
  other: 'Other tools',
}

const READING = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead'])
const EDITING = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const SHELL = new Set(['Bash', 'BashOutput', 'KillShell'])
const SEARCH = new Set(['WebSearch', 'WebFetch', 'ToolSearch'])
const PLANNING = new Set(['TodoWrite', 'TodoRead', 'Task', 'Agent', 'ExitPlanMode', 'EnterPlanMode', 'AskUserQuestion'])

/** The kind a tool's result counts as: one of the words, or `mcp:<server>` for an MCP server's tools. */
export function kindOf(tool: string): string {
  if (tool.startsWith('mcp__')) {
    const [server = '', ...rest] = tool.slice(5).split('__')
    // A lent plan tool is planning, whichever mod lends it.
    if (rest.join('__') === 'plan') return 'planning'
    return `mcp:${server}`
  }
  if (READING.has(tool)) return 'reading'
  if (EDITING.has(tool)) return 'editing'
  if (SHELL.has(tool)) return 'shell'
  if (SEARCH.has(tool)) return 'search'
  if (PLANNING.has(tool)) return 'planning'
  return 'other'
}

/**
 * The kinds one request is charged to: a subagent's request is `subagents`; a turn's
 * first request is the `prompt`; any other carries the results of the tools the
 * previous response called (each kind once), or `answering` when it carried none.
 */
export function kindsCarried(index: number, agentId: string | undefined, previousTools: readonly string[]): string[] {
  if (agentId !== undefined) return ['subagents']
  if (index === 0) return ['prompt']
  const kinds = [...new Set(previousTools.map(kindOf))]
  return kinds.length > 0 ? kinds : ['answering']
}

/** A label column holds this many cells at most. */
const LABEL_CELLS = 12

/** A kind's row label: a word in sentence case (`Shell`, `Other tools`), or an MCP server's own name, cut to the column. */
export function spendLabel(kind: string): string {
  if (kind.startsWith('mcp:')) return kind.slice(4).slice(0, LABEL_CELLS)
  return KIND_WORDS[kind] ?? kind
}

// claude-opus-4-1-20250805, us.anthropic.claude-sonnet-4-5-20250929-v1:0,
// claude-haiku-4-5@20251001, claude-opus-5: the family, then the major, then a
// one-digit minor when one follows (a date is never a minor).
const MODEL_ID = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d)(?!\d))?/

/**
 * A model's row label, read from its id: the family and version (`Fable 5.1`,
 * `Opus 4.6`, `Sonnet 5.5`). An id of another shape loses its `claude-` and a
 * trailing date (`nova-1`), cut to the column.
 */
export function modelLabel(model: string): string {
  const m = MODEL_ID.exec(model.toLowerCase())
  if (m) {
    const family = m[1] ?? ''
    return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${m[2] ?? ''}${m[3] === undefined ? '' : `.${m[3]}`}`
  }
  return model
    .replace(/^claude-/, '')
    .replace(/@.*$/, '')
    .replace(/-\d{8}$/, '')
    .slice(0, LABEL_CELLS)
}
