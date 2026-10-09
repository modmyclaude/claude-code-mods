// footprints through the real wiring: tool calls raised on the engine, the
// /footprints command, the pane mounted on the terminal and the desktop.
import { describe, expect, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'

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
    expect(on1.text).toBe('Footprints: touched files only.')
    expect(w.rec.opens).toEqual([PANE])
    const ui = await mount($, 'terminal')
    expect(await ui.find({ key: 'f:README.md' })).toBeUndefined()
    expect((await ui.find({ key: 'empty' }))?.text).toBe('Nothing touched yet.')
    const off = await footprints($, 'touched')
    expect(off.text).toBe('Footprints: all files.')
    expect(w.rec.opens).toEqual([PANE]) // already open: not opened again
    expect(await ui.find({ key: 'f:README.md' })).toBeDefined()
  })

  test('a pane the surface cannot seat says so in one toast', async ($, on) => {
    const w = world(on, { tracked: files, placed: false })
    await start($)
    const ran = await footprints($)
    expect(ran.text).toBeUndefined()
    expect(w.rec.toasts).toEqual(['Footprints cannot show its pane here: no surface attached that places panes'])
  })

  test('an unknown argument answers with the usage', async ($, on) => {
    world(on, { tracked: files })
    await start($)
    const ran = await footprints($, 'sideways')
    expect(ran.text).toContain('Usage: /footprints')
  })

  test('the command is registered when the session starts', async ($, on) => {
    const w = world(on, { tracked: files })
    await start($)
    expect(w.rec.registered).toEqual(['footprints'])
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

  test('with no pane and no edit yet, a Bash call runs no git at all', async ($, on) => {
    const w = world(on, { tracked: ['src/a.ts', 'src/b.ts'] })
    await start($)
    await bash($, 'ls')
    expect(statusRuns(w)).toBe(0)
    await $.tool.call({ tool: 'Edit', file_path: abs('src/a.ts'), old_string: 'x', new_string: 'y' })
    w.onBash(() => w.write('src/b.ts'))
    await bash($, 'touch src/b.ts')
    expect(statusRuns(w)).toBe(2) // after the first edit: before and after the call
    expect(statusNow(w)).toBe('edited 2')
  })
})
