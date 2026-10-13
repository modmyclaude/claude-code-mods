// The mission map: the main loop and every subagent as nodes, handoffs as
// edges, drawn as one SVG for the surfaces that draw vectors. It is a still
// picture: the desktop re-sets an interactive frame on every render pass of a
// hook that ticks, so there is no pulse and no tooltip; the full tasks go in
// the alt text. Its source depends on the mission's shape alone, never on the
// clock, so a tick redraws the same bytes.

import type { AntFarmAnt } from '../types'

export type MapNode = {
  id: string
  n?: number
  status: AntFarmAnt['status']
  parentId?: string
  /** The task, shortened for the label. Already cleaned. */
  label: string
  /** The task in full, for the tooltip. Already cleaned. */
  title: string
}

/** Nodes at most; the rest are counted. */
export const MAP_NODES_MAX = 10
const LABEL_MAX = 24
/** About one label character at the map's face, in CSS pixels. */
const CHAR_PX = 7
/** The map's own colours: it draws in a frame of its own, where theme keys do not reach; these read on light and dark. */
export const MAP_COLORS = { text: '#8b949e', running: '#58a6ff', done: '#3fb950', failed: '#f85149' } as const
const COLUMN = 200
const ROW = 22
const LEFT = 20
const TOP = 30
const LABEL_DX = 14

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

function short(s: string): string {
  const chars = [...s]
  return chars.length > LABEL_MAX ? `${chars.slice(0, LABEL_MAX - 1).join('')}…` : s
}

/** The nodes in mission order, at most `max`, a parent kept only when it is among them. */
export function mapNodes(list: readonly AntFarmAnt[], clean: (s: string) => string, max = MAP_NODES_MAX): { nodes: MapNode[]; hidden: number } {
  const sorted = [...list].sort((a, b) => (a.n ?? Number.MAX_SAFE_INTEGER) - (b.n ?? Number.MAX_SAFE_INTEGER) || a.startedAt - b.startedAt)
  const shown = sorted.slice(0, max)
  const ids = new Set(shown.map(a => a.id))
  const nodes = shown.map(a => {
    const task = clean(a.task)
    return {
      id: a.id,
      ...(a.n !== undefined ? { n: a.n } : {}),
      status: a.status,
      ...(a.parentId !== undefined && ids.has(a.parentId) ? { parentId: a.parentId } : {}),
      label: short(task),
      title: task,
    }
  })
  return { nodes, hidden: sorted.length - shown.length }
}

/** The SVG: a tree from the main loop, one column per depth, one row per node; running nodes pulse. */
export function missionMap(nodes: readonly MapNode[], hidden = 0): { source: string; alt: string; width: number; height: number } {
  const children = new Map<string | undefined, MapNode[]>()
  for (const node of nodes) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node])
  const placed: { node: MapNode; depth: number; row: number }[] = []
  let row = 1
  const visit = (parent: string | undefined, depth: number) => {
    for (const node of children.get(parent) ?? []) {
      placed.push({ node, depth, row })
      row += 1
      visit(node.id, depth + 1)
    }
  }
  visit(undefined, 1)
  const maxDepth = Math.max(1, ...placed.map(p => p.depth))
  const labelOf = (node: MapNode) => `${node.n !== undefined ? `#${node.n} ` : ''}${node.label}`
  // Wide enough for the longest label in the last column, so nothing is cut at the right edge.
  const rightEdge = Math.max(LEFT + LABEL_DX + 9 * CHAR_PX, ...placed.map(p => LEFT + p.depth * COLUMN + LABEL_DX + [...labelOf(p.node)].length * CHAR_PX))
  const width = rightEdge + 16
  const height = TOP + (row + (hidden > 0 ? 1 : 0)) * ROW
  const x = (depth: number) => LEFT + depth * COLUMN
  const y = (r: number) => TOP + r * ROW
  const at = new Map(placed.map(p => [p.node.id, p] as const))
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="11">`,
  )
  // Edges leave a parent from its bottom and arrive at a child from its left, so none runs through a label.
  parts.push(`<g stroke="${MAP_COLORS.text}" stroke-width="1.5" fill="none" stroke-opacity="0.6">`)
  for (const p of placed) {
    const from = p.node.parentId !== undefined ? at.get(p.node.parentId) : undefined
    const x1 = from !== undefined ? x(from.depth) : x(0)
    const y1 = (from !== undefined ? y(from.row) : y(0)) + 8
    const x2 = x(p.depth) - 8
    const y2 = y(p.row)
    parts.push(`<path d="M${x1} ${y1} C${x1} ${y1 + 14}, ${x2 - 24} ${y2}, ${x2} ${y2}"/>`)
  }
  parts.push('</g>')
  // The main loop's label sits above its node, out of the edges' way.
  parts.push(`<circle cx="${x(0)}" cy="${y(0)}" r="8" fill="none" stroke="${MAP_COLORS.text}" stroke-width="2"/>`)
  parts.push(`<text x="${x(0) - 8}" y="${y(0) - 13}" fill="${MAP_COLORS.text}">main loop</text>`)
  for (const p of placed) {
    const color = p.node.status === 'running' ? MAP_COLORS.running : p.node.status === 'failed' ? MAP_COLORS.failed : MAP_COLORS.done
    // A running node wears a halo in place of a pulse: a still picture cannot move.
    const halo = p.node.status === 'running' ? `<circle cx="${x(p.depth)}" cy="${y(p.row)}" r="11" fill="none" stroke="${color}" stroke-opacity="0.45" stroke-width="2"/>` : ''
    parts.push(
      `<g>${halo}<circle cx="${x(p.depth)}" cy="${y(p.row)}" r="7" fill="${color}"/>` +
        `<text x="${x(p.depth) + LABEL_DX}" y="${y(p.row) + 4}" fill="${MAP_COLORS.text}">${esc(labelOf(p.node))}</text></g>`,
    )
  }
  if (hidden > 0) parts.push(`<text x="${x(1)}" y="${y(row) + 4}" fill="${MAP_COLORS.text}">+${hidden} more</text>`)
  parts.push('</svg>')
  const running = nodes.filter(n => n.status === 'running').length
  const failed = nodes.filter(n => n.status === 'failed').length
  const done = nodes.length - running - failed
  const tasks = placed.map(p => `#${p.node.n ?? '?'} ${p.node.title}${p.node.parentId !== undefined ? ` (from #${at.get(p.node.parentId)?.node.n ?? '?'})` : ''}: ${p.node.status}`).join('; ')
  const alt = `Mission map: the main loop and ${nodes.length + hidden} subagents, ${running} running, ${done} done, ${failed} failed. ${tasks}`.slice(0, 900)
  return { source: parts.join(''), alt, width, height }
}
