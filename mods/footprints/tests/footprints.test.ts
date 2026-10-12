// footprints through the real wiring: tool calls raised on the engine, the
// /footprints command, the pane mounted on the terminal and the desktop.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

import { boltOf, rasterCells } from '../hooks/bolt-draw'

import { PANE, PLUGIN, ROOT, SURFACES, abs, paneProps, world, type World } from './world'

type Surface = (typeof SURFACES)[number]

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
}

const mount = ($: Engine, surface: Surface) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps() })

/** The styled name Text inside a file's row: the element whose own text is the name. */
async function nameOf(ui: Awaited<ReturnType<typeof mount>>, rel: string): Promise<FoundElement | undefined> {
  const row = await ui.find({ key: `f:${rel}` })
  const name = rel.split('/').pop() ?? rel
  const texts = (await ui.findAll({ type: 'Text', text: name })).filter(t => t.text === name)
  return row === undefined ? undefined : texts.find(t => row.text.includes(t.text))
}

/** The person typing `/footprints <args>` at the prompt of a terminal this wide. */
const footprints = ($: Engine, args = '', columns = 120) =>
  $.command.run({ command: 'footprints', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns } })

const header = async (ui: Awaited<ReturnType<typeof mount>>) => (await ui.find({ key: 'header' }))?.text
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
const statusNow = (w: World) => w.rec.statuses.at(-1)

describe('reads and edits', () => {
  test('a read glows blue, an edit turns amber, a new file gets its mark, on both surfaces', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts', 'README.md'] })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: abs('src/a.ts') })
    await $.tool.call({ tool: 'Edit', file_path: abs('src/b.ts'), old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Write', file_path: abs('src/c.ts'), content: 'new' })
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await header(ui), surface).toBe('read 1 · edited 2 · new 1')
      expect((await nameOf(ui, 'src/a.ts'))?.props.color, surface).toBe('suggestion')
      expect((await nameOf(ui, 'src/b.ts'))?.props.color, surface).toBe('warning')
      expect((await ui.find({ key: 'f:src/c.ts' }))?.text, surface).toContain('c.ts new')
      // untouched files stay dim so the trail stands out
      expect((await nameOf(ui, 'README.md'))?.props.dimColor, surface).toBe(true)
      await ui.unmount()
    }
    expect(statusNow(w)).toBe('edited 2')
  })

  test('a failed read or edit leaves no mark, and the result reaches the model unchanged', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    const read = await $.tool.call({ tool: 'Read', file_path: abs('src/missing.ts') })
    const edit = await $.tool.call({ tool: 'Edit', file_path: abs('src/missing.ts'), old_string: 'x', new_string: 'y' })
    expect(read.isError).toBe(true)
    expect(edit.text).toBe('File does not exist.')
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
    expect(await ui.find({ key: 'f:src/missing.ts' })).toBeUndefined()
    expect(w.rec.statuses.filter(s => s !== undefined)).toEqual([])
  })

  test('Glob and Grep mark the folder they searched; a project-wide search marks nothing', async ($, on) => {
    world(on, { tracked: ['src/a.ts', 'lib/x.ts'] })
    await start($)
    await $.tool.call({ tool: 'Grep', pattern: 'todo', path: abs('src') } as never)
    await $.tool.call({ tool: 'Glob', pattern: '**/*.ts', path: ROOT } as never)
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const folders = await ui.findAll({ type: 'Text', text: /^(src|lib)\/$/ })
      expect(folders.map(t => [t.text, t.props.color ?? null]), surface).toEqual([
        ['lib/', null],
        ['src/', 'suggestion'],
      ])
      expect(await header(ui), surface).toBe('read 0 · edited 0 · new 0') // a folder search is not a file read
      await ui.unmount()
    }
  })

  test('one file reached by its linked and its real spelling is one mark', async ($, on) => {
    world(on, { tracked: ['src/a.ts'], realRoot: '/private/work/proj' })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/private/work/proj/src/a.ts' })
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 1 · edited 1 · new 0')
    expect(await ui.find({ key: 'outside' })).toBeUndefined()
  })

  test('files outside the project are listed apart', async ($, on) => {
    world(on, { tracked: ['src/a.ts'], extern: ['/etc/hosts'] })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: '/etc/hosts' })
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'outside' }))?.text, surface).toBe('outside proj/etc/hosts')
      await ui.unmount()
    }
  })
})

describe('the shimmer', () => {
  test('a file shimmers while its edit runs, and the animation stops when it ends', async ($, on) => {
    let frames = 0 // shimmer periods asked of the clock; registered first, so it sits above the mocked clock
    on('clock.every', { ms: 120 }, ($, e, next) => {
      frames++
      return next(e)
    })
    const w = world(on, { tracked: ['src/index.ts'] })
    let phaseWrites = 0
    on('state.set', ($, e, next) => {
      if (e.key === 'phase') phaseWrites++
      return next(e)
    })
    await start($)
    await footprints($)
    const ui = await mount($, 'terminal')
    const release = w.hold()
    const editing = $.tool.call({ tool: 'Edit', file_path: abs('src/index.ts'), old_string: 'a', new_string: 'b' })
    await w.clock.settle()

    // Mid-edit: amber, drawn as head / bright band / tail, and the band moves with the clock.
    const band = async () => (await ui.findAll({ type: 'Text', text: /./ })).find(t => t.props.bold === true && 'index.ts'.includes(t.text))?.text
    await w.clock.advance(120 * 3)
    const early = await band()
    await w.clock.advance(120 * 2)
    const later = await band()
    expect(early).toBeDefined()
    expect(later).toBeDefined()
    expect(later).not.toBe(early)
    expect(phaseWrites).toBeGreaterThan(0)
    expect(frames).toBeGreaterThanOrEqual(5) // the counter does see the shimmer's periods

    release()
    await editing
    await w.clock.settle()
    const writesAtEnd = phaseWrites
    const framesAtEnd = frames
    await w.clock.advance(120 * 10)
    expect(phaseWrites).toBe(writesAtEnd) // no edit running: nothing drawn
    expect(frames - framesAtEnd).toBeLessThanOrEqual(1) // and the timer stopped on its next frame
    expect((await nameOf(ui, 'src/index.ts'))?.props.color).toBe('warning')
    expect(await band()).toBeUndefined()
  })

  test('a denied edit stops shimmering and leaves no mark', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    on('classic.PreToolUse', () => ({ deny: 'not this file' }))
    await start($)
    const ran = await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'a', new_string: 'b' })
    expect(ran.isError === true || ran.deny !== undefined).toBe(true)
    await footprints($)
    const ui = await mount($, 'desktop')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
    expect((await nameOf(ui, 'src/a.ts'))?.props.dimColor).toBe(true)
    expect(w.rec.tools).not.toContain('Edit') // the deny stood beneath the mod: the tool never ran
  })
})

describe('the shell', () => {
  test('after a Bash call, git status marks the files it changed, created and deleted', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts', 'README.md'] })
    await start($)
    await footprints($)
    w.onBash(() => {
      w.write('src/b.ts')
      w.write('notes.txt')
      w.remove('README.md')
    })
    await bash($, "sed -i '' s/a/b/ src/b.ts && echo hi > notes.txt && rm README.md")
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await header(ui), surface).toBe('read 0 · edited 3 · new 1 · deleted 1')
      expect((await nameOf(ui, 'src/b.ts'))?.props.color, surface).toBe('warning')
      expect((await ui.find({ key: 'f:src/b.ts' }))?.text, surface).toContain('(shell)')
      expect((await ui.find({ key: 'f:notes.txt' }))?.text, surface).toContain('notes.txt new (shell)')
      expect((await nameOf(ui, 'README.md'))?.props.strikethrough, surface).toBe(true)
      expect((await nameOf(ui, 'src/a.ts'))?.props.dimColor, surface).toBe(true)
      await ui.unmount()
    }
    expect(statusNow(w)).toBe('edited 3')
  })

  test('files dirty before the call and left alone, or only staged, are not marked', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    w.write('src/a.ts') // the person's own change, made before the session's Bash call
    await w.clock.advance(5000)
    await start($)
    await footprints($)
    w.onBash(() => w.stage('src/a.ts'))
    await bash($, 'git add src/a.ts')
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
  })

  test('a call the tool held read-only runs no git status after it', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    w.answer(tool => (tool === 'Bash' ? { result: { stdout: '', stderr: '', interrupted: false }, text: '', isReadOnly: true } : undefined))
    await start($)
    await footprints($)
    const before = w.rec.argv.length
    await bash($, 'ls')
    const statuses = w.rec.argv.slice(before).filter(argv => argv.includes('status'))
    expect(statuses).toHaveLength(1) // the snapshot before; none after a read-only run
  })

  test('outside a git repo the tree is a walk that skips node_modules, and the shell is not tracked', async ($, on) => {
    const w = world(on, { isGit: false, untracked: ['index.html', 'node_modules/x/y.js', 'js/app.js'] })
    await start($)
    w.onBash(() => w.write('index.html'))
    await bash($, 'touch index.html')
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'f:index.html' }), surface).toBeDefined()
      expect(await ui.find({ key: 'f:js/app.js' }), surface).toBeDefined()
      expect(await ui.find({ key: 'd:node_modules' }), surface).toBeUndefined()
      expect((await ui.find({ key: 'controls' }))?.text, surface).toContain('proj (not a git repo)')
      expect(await header(ui), surface).toBe('read 0 · edited 0 · new 0')
      await ui.unmount()
    }
    expect(w.rec.argv.filter(argv => argv.includes('status'))).toEqual([])
  })

  test('the tree honours .gitignore', async ($, on) => {
    world(on, { tracked: ['src/a.ts'], ignored: ['dist/bundle.js', 'node_modules/x/y.js'] })
    await start($)
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'f:src/a.ts' })).toBeDefined()
    expect(await ui.find({ key: 'd:dist' })).toBeUndefined()
    expect(await ui.find({ key: 'd:node_modules' })).toBeUndefined()
  })
})

describe('commits', () => {
  test('a git commit turns the files it committed green and leaves the rest amber', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    await $.tool.call({ tool: 'Edit', file_path: abs('src/b.ts'), old_string: 'x', new_string: 'y' })
    w.onBash(() => {
      w.stage('src/a.ts')
      w.commit()
    })
    await bash($, 'git add src/a.ts && git commit -m "a only"')
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await nameOf(ui, 'src/a.ts'))?.props.color, surface).toBe('success')
      expect((await nameOf(ui, 'src/b.ts'))?.props.color, surface).toBe('warning')
      expect(await header(ui), surface).toBe('read 0 · edited 2 · new 0 · committed 1')
      await ui.unmount()
    }
  })

  test('a commit that did not happen (HEAD did not move) turns nothing green', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    // the stash leaves the edited file clean, then the commit finds nothing to commit
    w.onBash(() => w.revert('src/a.ts'))
    await bash($, 'git stash && git commit -m "wip"')
    await footprints($)
    const ui = await mount($, 'terminal')
    expect((await nameOf(ui, 'src/a.ts'))?.props.color).toBe('warning')
    expect(await header(ui)).toBe('read 0 · edited 1 · new 0')
  })

  test('a file edited again after its commit is amber again', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    w.onBash(() => w.commitAll())
    await bash($, 'git commit -am "a"')
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'y', new_string: 'z' })
    await footprints($)
    const ui = await mount($, 'desktop')
    expect((await nameOf(ui, 'src/a.ts'))?.props.color).toBe('warning')
  })
})

describe('the pane', () => {
  const files = ['src/a.ts', 'src/b.ts', 'docs/guide.md', 'README.md']

  test('t toggles touched-only: untouched folders collapse and untouched files fold away', async ($, on) => {
    world(on, { tracked: files })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: abs('src/a.ts') })
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'touched' }))?.props.label, surface).toBe('touched only')
      expect((await ui.find({ key: 'd:docs' }))?.text, surface).toBe('▾ docs/')
      expect(await ui.find({ key: 'f:docs/guide.md' }), surface).toBeDefined()

      await ui.press({ key: 'touched' })
      expect((await ui.find({ key: 'touched' }))?.props.label, surface).toBe('show all files')
      expect((await ui.find({ key: 'd:docs' }))?.text, surface).toBe('▸ docs/ 1')
      expect(await ui.find({ key: 'f:docs/guide.md' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'f:src/b.ts' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'f:src/a.ts' }), surface).toBeDefined()
      expect((await ui.findAll({ type: 'Text', text: /untouched file/ })).map(t => t.text.trim()), surface).toEqual([
        '+ 1 untouched file',
        '+ 1 untouched file',
      ])

      await ui.press({ key: 'touched' }) // and back
      expect(await ui.find({ key: 'f:docs/guide.md' }), surface).toBeDefined()
      await ui.unmount()
    }
  })

  test('a project with more than 50 folders opens touched-only and says why; the full tree is one press away, and a choice stands', async ($, on) => {
    const many = Array.from({ length: 60 }, (_, i) => `pkg${String(i + 1).padStart(2, '0')}/index.ts`)
    const w = world(on, { tracked: [...many, 'README.md'] })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: abs('pkg07/index.ts') })
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'touched' }))?.props.label, surface).toBe('show all files')
      expect((await ui.find({ key: 'big' }))?.text, surface).toBe('touched only, since this project has 60 folders · t or /footprints touched shows all files')
      expect(await ui.find({ key: 'f:pkg07/index.ts' }), surface).toBeDefined()
      expect(await ui.find({ key: 'f:pkg08/index.ts' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'f:README.md' }), surface).toBeUndefined()
      await ui.unmount()
    }
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'touched' })
    expect((await ui.find({ key: 'touched' }))?.props.label).toBe('touched only')
    expect(await ui.find({ key: 'big' })).toBeUndefined()
    expect(await ui.find({ key: 'f:README.md' })).toBeDefined()
    await ui.press({ key: 'touched' }) // chosen now: touched-only again, and the note is gone for good
    expect(await ui.find({ key: 'f:README.md' })).toBeUndefined()
    expect(await ui.find({ key: 'big' })).toBeUndefined()
    await ui.unmount()
    // The choice stands on the other surface too, and from the prompt.
    const desk = await mount($, 'desktop')
    expect(await desk.find({ key: 'big' })).toBeUndefined()
    expect(await desk.find({ key: 'f:README.md' })).toBeUndefined()
    await desk.unmount()
    await footprints($, 'touched')
    expect(w.rec.toasts.at(-1)).toBe('All files')
  })

  test('on a big tree, /footprints touched starts from that default and shows all files first; a small tree starts open', async ($, on) => {
    const many = Array.from({ length: 51 }, (_, i) => `d${i + 1}/a.ts`)
    const w = world(on, { tracked: many })
    await start($)
    await footprints($)
    await footprints($, 'touched')
    expect(w.rec.toasts.at(-1)).toBe('All files')
    const ui = await mount($, 'terminal')
    expect((await ui.find({ key: 'touched' }))?.props.label).toBe('touched only')
    expect(await ui.find({ key: 'f:d51/a.ts' })).toBeDefined()
    await ui.unmount()
  })

  test('exactly 50 folders is not big: the tree opens whole', async ($, on) => {
    world(on, { tracked: Array.from({ length: 50 }, (_, i) => `d${i + 1}/a.ts`) })
    await start($)
    await footprints($)
    const ui = await mount($, 'terminal')
    expect((await ui.find({ key: 'touched' }))?.props.label).toBe('touched only')
    expect(await ui.find({ key: 'big' })).toBeUndefined()
    expect(await ui.find({ key: 'f:d50/a.ts' })).toBeDefined()
    await ui.unmount()
  })

  test('the button answers the t key', async ($, on) => {
    world(on, { tracked: files })
    await start($)
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'touched' }))?.props.hotkey, surface).toBe('t')
      await ui.unmount()
    }
  })

  test('/footprints touched toggles too, and opens the pane when it is closed', async ($, on) => {
    const w = world(on, { tracked: files })
    await start($)
    const on1 = await footprints($, 'touched')
    expect(on1).toEqual({}) // nothing for the model to read
    expect(w.rec.toasts).toEqual(['Touched files only'])
    expect(w.rec.opens).toEqual([PANE])
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'f:README.md' })).toBeUndefined()
    expect((await ui.find({ key: 'empty' }))?.text).toBe('Nothing touched yet.')
    const off = await footprints($, 'touched')
    expect(off).toEqual({})
    expect(w.rec.toasts.at(-1)).toBe('All files')
    expect(w.rec.opens).toEqual([PANE]) // already open: not opened again
    expect(await ui.find({ key: 'f:README.md' })).toBeDefined()
  })

  // Bolt: beside "Nothing touched yet." in the touched-only view, never beside
  // "Reading the file list..." or "No files here." (the same row), gone once a file is
  // touched, and out of the way in a narrow pane. A Raster on the terminal, one
  // code-font cell per character on the desktop.
  type Drawn = { type?: unknown; key?: unknown; props?: Record<string, unknown>; children?: unknown[] }
  const under = (node: unknown, key: string): Drawn | undefined => {
    if (node === null || typeof node !== 'object') return undefined
    const n = node as Drawn
    if (n.key === key || n.props?.key === key) return n
    for (const c of n.children ?? []) {
      const hit = under(c, key)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  /** Bolt's size as cells: a Raster's columns x rows, or the desktop's rows of one-cell Boxes. */
  const boltSize = (bolt: Drawn | undefined) => {
    if (bolt === undefined) return undefined
    if (bolt.type === 'Raster') return [bolt.props?.columns, bolt.props?.rows]
    const rows = (bolt.children ?? []) as Drawn[]
    return [(rows[0]?.children ?? []).length, rows.length]
  }

  test('Bolt waits beside "Nothing touched yet." alone; the other empty lines, a touch or a narrow pane leave it out', async ($, on) => {
    world(on, { tracked: [] })
    await start($)
    for (const surface of SURFACES) {
      // Touched-only before the file list is read: still reading, so no Bolt.
      const ui = await mount($, surface)
      await ui.press({ key: 'touched' })
      expect((await ui.find({ key: 'empty' }))?.text, surface).toBe('Reading the file list...')
      expect(await ui.find({ key: 'bolt' }), surface).toBeUndefined()
      await ui.press({ key: 'touched' })
      await ui.unmount()
    }
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect((await ui.find({ key: 'empty' }))?.text, surface).toBe('No files here.')
      expect(await ui.find({ key: 'bolt' }), surface).toBeUndefined()
      await ui.unmount()
    }
    await footprints($, 'touched')
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const tree = await ui.drawn()
      expect(boltSize(under(under(tree, 'empty'), 'bolt')), surface).toEqual([3, 2])
      if (surface === 'terminal') expect(under(tree, 'bolt')?.props?.cells).toBe(rasterCells(boltOf({ size: 'tiny', pose: 'idle' })))
      expect(under(tree, 'bolt')?.type, surface).toBe(surface === 'terminal' ? 'Raster' : 'Box')
      if (surface === 'desktop') {
        const cells = ((under(tree, 'bolt')?.children ?? []) as Drawn[]).flatMap(row => (row.children ?? []) as Drawn[])
        expect(cells.every(cell => cell.type === 'Box' && cell.props?.width === 1)).toBe(true)
      }
      expect((await ui.find({ key: 'empty' }))?.text, surface).toContain('Nothing touched yet.')
      await ui.unmount()
      const narrow = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PANE, props: paneProps({ bodyColumns: 30 }) })
      expect(await narrow.find({ key: 'bolt' }), surface).toBeUndefined()
      expect((await narrow.find({ key: 'empty' }))?.text, surface).toBe('Nothing touched yet.')
      await narrow.unmount()
    }
    await $.tool.call({ tool: 'Write', file_path: abs('src/new.ts'), content: 'new' })
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'f:src/new.ts' }), surface).toBeDefined()
      expect(await ui.find({ key: 'empty' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'bolt' }), surface).toBeUndefined()
      await ui.unmount()
    }
  })

  test('a pane the surface cannot seat says so in one toast', async ($, on) => {
    const w = world(on, { tracked: files, placed: false })
    await start($)
    const ran = await footprints($)
    expect(ran.text).toBeUndefined()
    expect(w.rec.toasts).toEqual(['Cannot show its pane here: no surface attached that places panes'])
  })

  test('an unknown argument answers with the usage, in a toast', async ($, on) => {
    const w = world(on, { tracked: files })
    await start($)
    const ran = await footprints($, 'sideways')
    expect(ran).toEqual({})
    expect(w.rec.toasts).toEqual(['/footprints opens the pane, /footprints touched toggles touched-only'])
  })

  test('opening the pane answers {}: the pane is the answer, the model reads nothing', async ($, on) => {
    const w = world(on, { tracked: files })
    await start($)
    expect(await footprints($)).toEqual({})
    expect(w.rec.opens).toEqual([PANE])
    expect(w.rec.toasts).toEqual([])
  })

  test('the command is registered when the session starts', async ($, on) => {
    const w = world(on, { tracked: files })
    await start($)
    expect(w.rec.registered).toEqual([{ name: 'footprints', immediate: true }]) // opens while Claude works
  })

  test('a big untouched folder starts collapsed with its file count', async ($, on) => {
    const vendor = Array.from({ length: 60 }, (_, i) => `vendor/f${i}.js`)
    world(on, { tracked: ['src/a.ts', ...vendor] })
    await start($)
    await footprints($)
    const ui = await mount($, 'terminal')
    expect((await ui.find({ key: 'd:vendor' }))?.text).toBe('▸ vendor/ 60')
    expect(await ui.find({ key: 'f:vendor/f1.js' })).toBeUndefined()
  })
})

describe('the status line and the session', () => {
  test('the status line counts edits with the pane never opened', async ($, on) => {
    const w = world(on, { tracked: ['a.ts', 'b.ts'] })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: abs('a.ts') })
    expect(w.rec.statuses.filter(s => s !== undefined)).toEqual([]) // reads alone: no status
    await $.tool.call({ tool: 'Edit', file_path: abs('a.ts'), old_string: 'x', new_string: 'y' })
    expect(statusNow(w)).toBe('edited 1')
    await $.tool.call({ tool: 'Write', file_path: abs('b.ts'), content: 'z' })
    expect(statusNow(w)).toBe('edited 2')
    expect(w.rec.opens).toEqual([])
  })

  test('/clear starts a clean trail', async ($, on) => {
    const w = world(on, { tracked: ['a.ts'] })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: abs('a.ts'), old_string: 'x', new_string: 'y' })
    expect(statusNow(w)).toBe('edited 1')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(statusNow(w)).toBeUndefined()
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
  })

  test('when its own bookkeeping fails, every tool call still goes through with its result', async ($, on) => {
    const w = world(on, { tracked: ['a.ts'], failing: true })
    await start($)
    const read = await $.tool.call({ tool: 'Read', file_path: abs('a.ts') })
    expect(read.text).toBe('x')
    const edit = await $.tool.call({ tool: 'Edit', file_path: abs('a.ts'), old_string: 'x', new_string: 'y' })
    expect(edit.text).toBe('The file has been updated.')
    const shell = await bash($, 'echo hi')
    expect(shell.deny).toBeUndefined()
    expect(w.rec.tools).toEqual(['Read', 'Edit', 'Bash'])
  })
})

describe('mentions', () => {
  test('an @-mentioned file counts as read; one the engine could not attach does not', async ($, on) => {
    world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    on('prompt.mention', ($, e) => ({ type: e.path.endsWith('a.ts') ? 'file' : null }))
    await start($)
    await $.prompt.mention({ mention: 'src/a.ts', path: abs('src/a.ts') })
    await $.prompt.mention({ mention: 'src/b.ts', path: abs('src/b.ts') })
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 1 · edited 0 · new 0')
    expect((await nameOf(ui, 'src/a.ts'))?.props.color).toBe('suggestion')
  })
})

describe('slow git', () => {
  const statusRuns = (w: World) => w.rec.argv.filter(argv => argv.includes('status')).length

  test('a git status over 2 s pauses shell tracking once, says so once, and edits are still tracked', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'], statusMs: 2500 })
    await start($)
    await footprints($)
    const first = bash($, 'ls')
    await w.clock.settle()
    await w.clock.advance(2500)
    await first
    expect(w.rec.logs).toEqual(['Footprints: shell tracking paused, git status is slow in this repo'])

    const runs = statusRuns(w)
    w.onBash(() => w.write('src/b.ts'))
    await bash($, 'touch src/b.ts') // answers at once: no git on the way
    await bash($, 'ls')
    expect(statusRuns(w)).toBe(runs)
    expect(w.rec.logs).toHaveLength(1)

    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 1 · new 0') // the edit counts; the paused shell change does not
    expect(statusNow(w)).toBe('edited 1')
  })

  test('a git status that times out pauses it too', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'], statusMs: 3000, statusTimesOut: true })
    await start($)
    await footprints($)
    const call = bash($, 'ls')
    await w.clock.settle()
    await w.clock.advance(3000)
    const ran = await call
    expect(ran.deny).toBeUndefined() // the command itself still ran
    expect(w.rec.logs).toEqual(['Footprints: shell tracking paused, git status is slow in this repo'])
  })

  test('a git status under 2 s keeps tracking on', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'], statusMs: 1500 })
    await start($)
    await footprints($)
    w.onBash(() => w.write('src/a.ts'))
    const call = bash($, 'touch src/a.ts')
    await w.clock.settle()
    await w.clock.advance(1500) // the snapshot before
    await w.clock.advance(1500) // and the one after
    await call
    expect(w.rec.logs).toEqual([])
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 1 · new 0')
  })

  test('a change made only through the shell reaches the status line with the pane closed', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    await start($)
    w.onBash(() => w.write('src/b.ts'))
    await bash($, 'npx prettier --write src/b.ts')
    expect(statusRuns(w)).toBe(2) // before and after the call, with no pane and no edit
    expect(statusNow(w)).toBe('edited 1')
    expect(w.rec.opens).toEqual([])
  })
})

describe('file names with control characters', () => {
  // ESC, BEL, NEL (U+0085) and a colored name: all legal in a file name, all refused by the engine if drawn.
  const weird = ['src/esc\x1bname.ts', 'src/bell\x07.ts', 'src/nel\u0085.ts', 'src/\x1b[31mred\x1b[0m.ts']
  const control = /[\x00-\x1f\x7f-\x9f]/

  test('a repo holding them still draws its tree on both surfaces, names cleaned', async ($, on) => {
    world(on, { tracked: ['src/a.ts', ...weird] })
    await start($)
    await $.tool.call({ tool: 'Read', file_path: abs('src/bell\x07.ts') })
    await $.tool.call({ tool: 'Write', file_path: abs('src/new\x1b[2Jfile.ts'), content: 'x' })
    await footprints($)
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await header(ui), surface).toBe('read 1 · edited 1 · new 1')
      expect((await ui.find({ key: 'f:src/a.ts' }))?.text, surface).toContain('a.ts')
      expect((await ui.find({ key: 'f:src/esc\uFFFDname.ts' }))?.text, surface).toContain('esc\uFFFDname.ts')
      expect((await ui.find({ key: 'f:src/red.ts' }))?.text, surface).toContain('red.ts')
      expect((await ui.find({ key: 'f:src/bell\uFFFD.ts' }))?.text, surface).toContain('bell\uFFFD.ts')
      expect((await ui.find({ key: 'f:src/newfile.ts' }))?.text, surface).toContain('newfile.ts new')
      const everything = await ui.findAll({})
      expect(everything.length, surface).toBeGreaterThan(10)
      for (const element of everything) {
        expect(control.test(`${element.text}${element.key ?? ''}`), `${surface}: ${JSON.stringify(element.text)}`).toBe(false)
      }
      await ui.unmount()
    }
  })
})

describe('review fixes', () => {
  test('node_modules is skipped in a git repo even when .gitignore does not list it', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'package.json'], untracked: ['node_modules/x/y.js', 'pkg/node_modules/z/w.js', 'pkg/p.ts'] })
    await start($)
    await footprints($)
    w.onBash(() => w.write('node_modules/fresh/index.js')) // an install writes there
    await bash($, 'npm install fresh')
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      expect(await ui.find({ key: 'd:node_modules' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'd:pkg/node_modules' }), surface).toBeUndefined()
      expect(await ui.find({ key: 'f:pkg/p.ts' }), surface).toBeDefined()
      expect(await ui.find({ key: 'f:src/a.ts' }), surface).toBeDefined()
      expect(await header(ui), surface).toBe('read 0 · edited 0 · new 0') // the install marks nothing
      await ui.unmount()
    }
  })

  test('with 400+ files already dirty, a file the command changed is still marked', async ($, on) => {
    const noise = Array.from({ length: 450 }, (_, i) => `scratch/n${String(i).padStart(3, '0')}.txt`)
    const w = world(on, { tracked: ['src/a.ts'], untracked: noise })
    await start($)
    await footprints($)
    w.onBash(() => w.write('src/a.ts'))
    await bash($, "sed -i '' s/x/y/ src/a.ts")
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 1 · new 0')
    expect((await nameOf(ui, 'src/a.ts'))?.props.color).toBe('warning')
  })

  test('no shimmer frames are written while the pane is not open', async ($, on) => {
    let phaseWrites = 0
    on('state.set', ($, e, next) => {
      if (e.key === 'phase') phaseWrites++
      return next(e)
    })
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    const release = w.hold()
    const editing = $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    await w.clock.advance(120 * 10)
    release()
    await editing
    expect(phaseWrites).toBe(0)
  })

  test('an edit held for review (staged) is not counted', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    w.answer(tool => (tool === 'Edit' ? { result: { filePath: abs('src/a.ts'), staged: true }, text: 'Held for review.' } : undefined))
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'a', new_string: 'b' })
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
    expect(w.rec.statuses.filter(s => s !== undefined)).toEqual([])
  })

  test('a huge repo keeps at most 20,000 names and says so', async ($, on) => {
    const many = Array.from({ length: 20_050 }, (_, i) => `d${String(Math.floor(i / 100)).padStart(3, '0')}/f${i}.ts`)
    world(on, { tracked: many })
    await start($)
    await footprints($)
    await footprints($, 'touched') // 201 folders: it opened touched-only, so show every file
    const ui = await mount($, 'terminal')
    expect((await ui.find({ key: 'note' }))?.text).toBe('showing 20000 files of a longer list')
    expect(await ui.find({ key: 'd:d199' })).toBeDefined()
    expect(await ui.find({ key: 'd:d200' })).toBeUndefined() // the 50 names past the cap are not kept
  })

  test('files a commit brings in (a pull) appear in an open pane', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await footprints($)
    w.onBash(() => {
      w.write('pulled.ts')
      w.stage('pulled.ts')
      w.commit()
    })
    await bash($, 'git pull --ff-only')
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'f:pulled.ts' })).toBeDefined()
  })

  test('a reload mid-edit stops the shimmer', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await footprints($)
    const ui = await mount($, 'terminal')
    const release = w.hold()
    const editing = $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    await start($) // the engine raises session.start again on a reload
    await w.clock.advance(120 * 3)
    const bands = (await ui.findAll({ type: 'Text', text: /./ })).filter(t => t.props.bold === true && 'a.ts'.includes(t.text))
    expect(bands).toEqual([])
    release()
    await editing
  })

  test('a stat that fails for a file that still exists is not a delete', async ($, on) => {
    on('fs.*', ($, e, next) =>
      (next.event === 'fs.stat' && String((e as { path?: string }).path).endsWith('/src/b.ts') ? { deny: 'EACCES' } : next(e)) as never,
    )
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    await start($)
    await footprints($)
    w.onBash(() => {
      w.write('src/a.ts')
      w.write('src/b.ts')
    })
    await bash($, 'touch src/a.ts src/b.ts')
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 1 · new 0')
  })
})

describe('polish', () => {
  test('the shimmer stops while the pane is closed, and opening the pane mid-edit starts it again', async ($, on) => {
    let frames = 0 // registered first, so it sits above the mocked clock
    on('clock.every', { ms: 120 }, ($, e, next) => {
      frames++
      return next(e)
    })
    const w = world(on, { tracked: ['src/index.ts'] })
    await start($)
    const release = w.hold()
    const editing = $.tool.call({ tool: 'Edit', file_path: abs('src/index.ts'), old_string: 'a', new_string: 'b' })
    await w.clock.settle()
    await w.clock.advance(120 * 10)
    expect(frames).toBeLessThanOrEqual(1) // one frame found no pane and stopped the timer

    await footprints($)
    const ui = await mount($, 'terminal')
    await w.clock.advance(120 * 4)
    expect(frames).toBeGreaterThanOrEqual(4)
    const band = (await ui.findAll({ type: 'Text', text: /./ })).find(t => t.props.bold === true && 'index.ts'.includes(t.text))
    expect(band).toBeDefined()
    release()
    await editing
  })

  test('a file created and then removed through the shell leaves no trace', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await $.tool.call({ tool: 'Write', file_path: abs('tmp.txt'), content: 'x' })
    expect(statusNow(w)).toBe('edited 1')
    w.onBash(() => w.remove('tmp.txt'))
    await bash($, 'rm tmp.txt')
    await footprints($)
    const ui = await mount($, 'terminal')
    expect(await header(ui)).toBe('read 0 · edited 0 · new 0')
    expect(await ui.find({ key: 'f:tmp.txt' })).toBeUndefined()
    expect(statusNow(w)).toBeUndefined()
  })

  test('/footprints turns paused shell tracking back on', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'], statusMs: 2500 })
    await start($)
    const first = bash($, 'ls')
    await w.clock.settle()
    await w.clock.advance(2500)
    await first
    expect(w.rec.logs).toHaveLength(1)
    const runs = w.rec.argv.filter(argv => argv.includes('status')).length
    await bash($, 'ls') // paused: no git
    expect(w.rec.argv.filter(argv => argv.includes('status')).length).toBe(runs)
    await footprints($)
    const again = bash($, 'ls')
    await w.clock.settle()
    await w.clock.advance(2500)
    await again
    expect(w.rec.argv.filter(argv => argv.includes('status')).length).toBeGreaterThan(runs)
  })

  test('a refused pane still says so in one line, and the command answers {}', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'], openDenied: 'another mod holds this pane' })
    await start($)
    expect(await footprints($)).toEqual({})
    expect(w.rec.toasts).toEqual(['Could not open its pane here.'])
  })

  test('git runs with the exact pathspecs proven on real git', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts'] })
    await start($)
    await footprints($)
    await bash($, 'ls')
    const ls = w.rec.argv.find(argv => argv.includes('ls-files')) ?? []
    const st = w.rec.argv.find(argv => argv.includes('status')) ?? []
    expect(ls.slice(ls.indexOf('--'))).toEqual(['--', '.', ':(exclude,glob)**/node_modules/**'])
    expect(st.slice(st.indexOf('--'))).toEqual(['--', ':/', ':(top,exclude,glob)**/node_modules/**'])
  })

  test('control characters in the root name and in a refusal reason are cleaned', async ($, on) => {
    const control = /[\x00-\x1f\x7f-\x9f]/
    const w = world(on, { tracked: ['a.ts'], root: '/work/pro\x07j', placed: false, reason: 'no\x07room \x1b[31mhere' })
    await start($)
    await footprints($)
    expect(w.rec.toasts).toEqual(['Cannot show its pane here: no\uFFFDroom here'])
    for (const surface of SURFACES) {
      const ui = await mount($, surface)
      const controls = await ui.find({ key: 'controls' })
      expect(controls?.text, surface).toContain('pro\uFFFDj')
      expect(control.test(controls?.text ?? ''), surface).toBe(false)
      await ui.unmount()
    }
  })
})
