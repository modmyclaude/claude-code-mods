import { describe, expect, test } from 'claude-code/testing'
import { esc, MAP_NODES_MAX, mapNodes, missionMap } from '../hooks/map'
import type { MapNode } from '../hooks/map'

type Ant = Parameters<typeof mapNodes>[0][number]
const ant = (id: string, n: number, over: Partial<Ant> = {}): Ant =>
  ({ id, n, task: `Task ${id}`, type: 't', model: 'm', startedAt: n, status: 'running', usage: { requests: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, ...over }) as unknown as Ant
const id = (s: string) => s

describe('mapNodes', () => {
  test('mission order, a parent kept only among the shown, the rest counted', () => {
    const list = [ant('b', 2, { parentId: 'a' }), ant('a', 1), ant('c', 3, { parentId: 'zz' })]
    const { nodes, hidden } = mapNodes(list, id)
    expect(nodes.map(n => n.id)).toEqual(['a', 'b', 'c'])
    expect(nodes[1]!.parentId).toBe('a')
    expect(nodes[2]!.parentId).toBeUndefined()
    expect(hidden).toBe(0)
    const many = Array.from({ length: MAP_NODES_MAX + 3 }, (_, i) => ant(`x${i}`, i + 1))
    expect(mapNodes(many, id).hidden).toBe(3)
  })
  test('the label is short, the title whole, both cleaned', () => {
    const { nodes } = mapNodes([ant('a', 1, { task: 'A task long enough to be cut for the label but kept whole for the tooltip' })], s => s.toUpperCase())
    expect(nodes[0]!.label.length).toBeLessThan(26)
    expect(nodes[0]!.label.endsWith('…')).toBe(true)
    expect(nodes[0]!.title).toBe('A TASK LONG ENOUGH TO BE CUT FOR THE LABEL BUT KEPT WHOLE FOR THE TOOLTIP')
  })
})

describe('missionMap', () => {
  const node = (over: Partial<MapNode> & { id: string }): MapNode => ({ status: 'running', label: over.id, title: over.id, ...over })
  test('a node per subagent and the main loop, an edge per subagent, a halo on a running one, nothing animated or interactive, labels escaped', () => {
    const nodes = [node({ id: 'a', n: 1, title: 'fix <b> & "c"', label: 'fix <b>' }), node({ id: 'b', n: 2, parentId: 'a', status: 'done' }), node({ id: 'c', n: 3, status: 'failed' })]
    const { source, alt, width, height } = missionMap(nodes)
    expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect((source.match(/<circle /g) ?? []).length).toBe(5) // main, three nodes, one halo
    expect((source.match(/<path /g) ?? []).length).toBe(3)
    expect(source).not.toContain('<animate')
    expect(source).not.toContain('<title>')
    expect(source).toContain('>#1 fix &lt;b&gt;<')
    expect(source).toContain('>#2 b<')
    expect(source).not.toContain('<script')
    expect(alt.startsWith('Mission map: the main loop and 3 subagents, 1 running, 1 done, 1 failed. #1 fix <b> & "c": running; #2 b (from #1): done; #3 c: failed')).toBe(true)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })
  test('the same shape draws the same bytes, a handoff goes one column right, and the width holds the longest label', () => {
    const nodes = [node({ id: 'a', n: 1 }), node({ id: 'b', n: 2, parentId: 'a' })]
    expect(missionMap(nodes).source).toBe(missionMap(nodes).source)
    expect(missionMap(nodes).width).toBeGreaterThan(missionMap([node({ id: 'a', n: 1 })]).width)
    const long = missionMap([node({ id: 'a', n: 1, label: 'x'.repeat(24) })])
    const short = missionMap([node({ id: 'a', n: 1, label: 'x' })])
    expect(long.width - short.width).toBeGreaterThanOrEqual(23 * 6)
  })
  test('edges leave a parent from its bottom, never through a label, and the main loop label sits above its node', () => {
    const { source } = missionMap([node({ id: 'a', n: 1 })])
    expect(source).toContain('<path d="M20 38 C')
    expect(source).toContain('y="17" fill="#8b949e">main loop</text>')
  })
  test('the overflow is counted and the whole thing stays well under the limit', () => {
    const nodes = Array.from({ length: MAP_NODES_MAX }, (_, i) => node({ id: `n${i}`, n: i + 1, title: 'x'.repeat(200) }))
    const { source } = missionMap(nodes, 7)
    expect(source).toContain('+7 more')
    expect(source.length).toBeLessThan(131072)
  })
  test('esc covers the five', () => {
    expect(esc(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
