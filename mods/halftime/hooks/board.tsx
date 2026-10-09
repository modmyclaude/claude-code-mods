// halftime's board: the one surface module (a `Client`), run by the terminal
// or the desktop app. It paints the rows the hooks module hands it and passes
// on the person's keys and clicks. It knows no game and keeps no run state, so
// the hooks module can unmount it at any moment (the whistle) and lose nothing.
//
// Self-contained on purpose: its one import is types only (erased), so it
// loads the same wherever the surface runs it.

import type { ClientKeyEvent, ClientPointerEvent, ClientSurface } from 'claude-code'

/** [text, color, background, flags]: '' and 0 for none; flags 1 bold, 2 dim, 4 inverse. */
type Seg = [string, string, string, number]
type Grid = { x: number; cw: number; ox: number; oy: number; w: number; h: number }
type Props = {
  rid: number
  live: boolean
  tick: number
  keys: string[]
  ack: [string, number]
  title: Seg[]
  rows: Seg[][]
  grid: Grid | null
  hint: string
  wait: string
  needClick: boolean
  showHint: boolean
}

/** What this instance remembers between calls; dropped with the instance. */
type Local = {
  iid: string
  seq: number
  arm: number
  armed: boolean
  /** Input not yet applied by the hooks module; resent whole until acknowledged. */
  ev: [number, string][]
  props: Props
  stop: (() => void) | null
}

type Surface = ClientSurface<Local>
type TextStyle = { color?: string; backgroundColor?: string; bold?: boolean; dimColor?: boolean; inverse?: boolean }

const BOLD = 1
const DIM = 2
const INVERSE = 4
const MAX_QUEUE = 32

const keyName = (key: string) => (key === ' ' || key === 'space' ? 'space' : key.length === 1 ? key.toLowerCase() : key)

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID ? c.randomUUID() : `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`
}

/** Every post carries the whole unacknowledged queue: a post a later one replaces loses nothing. */
function send(surface: Surface, local: Local, tick: boolean) {
  surface.post({ iid: local.iid, arm: local.arm, ev: local.ev, tick })
}

/** The frame clock runs only while the run is in play and this board holds the keys. */
function syncTicker(surface: Surface, local: Local) {
  const want = local.props.live && local.props.tick > 0 && local.armed
  if (want && !local.stop) local.stop = surface.every(local.props.tick, () => send(surface, local, true))
  if (!want && local.stop) {
    local.stop()
    local.stop = null
  }
}

function queue(local: Local, item: string) {
  local.seq += 1
  local.ev.push([local.seq, item])
  if (local.ev.length > MAX_QUEUE) local.ev.splice(0, local.ev.length - MAX_QUEUE)
}

function start(surface: Surface, props: Props): Local {
  const local: Local = { iid: newId(), seq: 0, arm: 0, armed: false, ev: [], props, stop: null }
  surface.setState(local)
  surface.onKey((event: ClientKeyEvent) => {
    const key = keyName(event.key)
    // Only the run's own keys travel; Enter, y, n and digits are never in that list.
    if (event.ctrl || event.meta || !local.props.keys.includes(key)) return
    if (!local.armed) {
      local.armed = true
      local.arm += 1
    }
    queue(local, key)
    send(surface, local, false)
    syncTicker(surface, local)
    surface.setState(local)
  })
  surface.onPointer((event: ClientPointerEvent) => {
    if (event.type !== 'down') return
    // A click on a board not in play (or not yet holding the keys) takes the keys and starts or resumes.
    if (!local.armed || !local.props.live) {
      local.armed = true
      local.arm += 1
      send(surface, local, false)
      syncTicker(surface, local)
      surface.setState(local)
      return
    }
    const button = event.button ?? 'left'
    const g = local.props.grid
    if (!g) {
      // A game with no field to aim at (dash): any click is its one action.
      queue(local, `click:0,0,${button}`)
    } else {
      // The field starts on the board's second row; turn the cell under the pointer into a field cell.
      const row = event.y - 1
      const cx = Math.floor((event.x - g.x) / g.cw) + g.ox
      const cy = row + g.oy
      if (row < 0 || row >= local.props.rows.length || cx < 0 || cy < 0 || cx >= g.w || cy >= g.h) return
      queue(local, `click:${cx},${cy},${button}`)
    }
    send(surface, local, false)
  })
  return local
}

export default function Board(props: Props, surface: Surface) {
  const local = surface.state ?? start(surface, props)
  local.props = props
  // Drop what the hooks module has applied; a new instance id starts its own count.
  if (props.ack[0] === local.iid) local.ev = local.ev.filter(([n]) => n > props.ack[1])
  syncTicker(surface, local)

  const { Box, Text } = surface.elements
  const seg = (s: Seg) => {
    const p: TextStyle = {}
    if (s[1]) p.color = s[1]
    if (s[2]) p.backgroundColor = s[2]
    const flags = s[3] ?? 0
    if (flags & BOLD) p.bold = true
    if (flags & DIM) p.dimColor = true
    if (flags & INVERSE) p.inverse = true
    return <Text {...p}>{s[0]}</Text>
  }
  const line = (segs: Seg[]) => <Text wrap="truncate-end">{segs.map(seg)}</Text>
  const status =
    props.live && local.armed
      ? props.hint
      : props.wait + (props.needClick && !local.armed ? ' - click the board to take the keys' : '')
  return (
    <Box flexDirection="column">
      {line(props.showHint ? props.title : [...props.title, [`  ${status}`, 'subtle', '', DIM]])}
      {props.rows.map(line)}
      {props.showHint ? <Text dimColor wrap="truncate-end">{status}</Text> : null}
    </Box>
  )
}
