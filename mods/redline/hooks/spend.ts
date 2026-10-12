// Where the money went: which kind of work a model request carried. A request's
// input holds the results of the previous response's tool calls in the same loop,
// so each request is charged to the kinds of those tools, read off the response
// stream redline already watches; the first request of a turn carries the prompt,
// a subagent's requests are one kind. Nothing is guessed from the transcript.

import { priceRow } from './prices'

/** The kinds, in the words the pane uses. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  prompt: 'prompt',
  reading: 'reading',
  editing: 'editing',
  shell: 'shell',
  search: 'search',
  planning: 'planning',
  subagents: 'subagents',
  answering: 'answering',
  other: 'other',
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

/** A kind's row label and the words that lead its value (`MCP · ` for a server). */
export function spendLabel(kind: string): { label: string; prefix: string } {
  if (kind.startsWith('mcp:')) return { label: kind.slice(4).slice(0, 12), prefix: 'MCP · ' }
  return { label: KIND_WORDS[kind] ?? kind, prefix: '' }
}

/** A model's row label: its price-table family, else the id without its vendor prefix. */
export function modelLabel(model: string): string {
  return priceRow(model)?.label ?? model.replace(/^claude-/, '').slice(0, 12)
}
