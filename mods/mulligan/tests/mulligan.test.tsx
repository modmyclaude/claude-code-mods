// mulligan through the real chains: a snapshot before a destructive command,
// kept only once it ran, the band, /mulligan's list, restore after a confirm,
// diff and drop, and every file it writes under ~/.claude/mulligan.

import { describe, expect, test } from 'claude-code/testing'

import { KEEP } from '../hooks/register'
import { HEAD, HOME, PANE_PROPS, PLUGIN, ROOT, SHA, SURFACES, bandTexts, bash, folderOf, indexOf, mulligan, put, rmTree, start, world } from './world'
import type { World } from './world'

/** A git project: a tracked source file and an ignored build folder. */
function project(w: World): void {
  put(w, 'src/app.ts', 'export const a = 1\n', true)
  put(w, 'dist/app.js', 'var a = 1\n')
  put(w, 'dist/app.js.map', '{}\n')
}

/** The pane, mounted: the caller presses and unmounts. */
function pane($: Parameters<typeof start>[0], surface: (typeof SURFACES)[number] = 'terminal') {
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'mulligan', props: PANE_PROPS })
}

async function paneTexts($: Parameters<typeof start>[0], surface: (typeof SURFACES)[number] = 'terminal') {
  const ui = await pane($, surface)
  const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return texts
}

describe('a snapshot before a destructive command', () => {
  test('rm -rf dist saves dist before the tool runs, then the band says how to restore it', async ($, on) => {
    const w = world(on)
    project(w)
    w.effects['rm -rf dist'] = w => rmTree(w, 'dist')
    await start($)
    await bash($, 'rm -rf dist')
    expect(w.ran).toEqual(['rm -rf dist'])
    expect(w.seenAtRun[0]).toHaveLength(1) // the archive was there when the command ran
    const index = indexOf(w)
    expect(index.snapshots).toEqual([{ n: 1, at: expect.any(Number), command: 'rm -rf dist', scope: 'dist', archive: 'slot-0.tar', bytes: expect.any(Number) }])
    expect(JSON.parse(w.files[`${folderOf(w)}/slot-0.tar`]!).map((e: { name: string }) => e.name)).toEqual(['dist/app.js', 'dist/app.js.map'])
    for (const surface of SURFACES) {
      expect(await bandTexts($, surface), surface).toEqual(['mulligan: saved a do-over before "rm -rf dist" (dist) · /mulligan restore 1'])
    }
    await w.clock.advance(8_000)
    expect(await bandTexts($)).toEqual([])
  })

  test('a command that destroys nothing takes no snapshot and runs nothing of its own', async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    for (const command of ['ls -la', 'npm test', 'git status', 'rm notes.txt', 'git push --force']) await bash($, command)
    expect(w.runs.filter(r => !r.endsWith('rev-parse --is-inside-work-tree'))).toEqual([])
    expect(w.writes).toEqual([])
  })

  test('git reset --hard saves the tracked changes as a commit object; nothing is copied', async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    await start($)
    await bash($, 'git reset --hard')
    expect(w.runs).toContain(': git stash create')
    expect(w.runs.some(r => r.includes('tar -cf'))).toBe(false)
    expect(indexOf(w).snapshots[0]).toMatchObject({ scope: 'tracked changes', sha: SHA, bytes: 0 })
    expect(indexOf(w).snapshots[0]?.archive).toBeUndefined()
  })

  test('with nothing changed since the last commit, HEAD stands for the tracked files', async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    await bash($, 'git checkout -- .')
    expect(indexOf(w).snapshots[0]?.sha).toBe(HEAD)
  })

  test('git clean copies the untracked files git lists, and only those', async ($, on) => {
    const w = world(on)
    project(w)
    put(w, 'notes/todo.md', '- ship\n')
    w.untracked = ['notes/todo.md']
    await start($)
    await bash($, 'git clean -fd')
    const archive = JSON.parse(w.files[`${folderOf(w)}/slot-0.tar`]!) as { name: string }[]
    expect(archive.map(e => e.name)).toEqual(['notes/todo.md'])
    expect(indexOf(w).snapshots[0]?.scope).toBe('untracked files')
  })

  test('without git, a target only known as it runs saves the project, never .git or node_modules', async ($, on) => {
    const w = world(on)
    w.isGit = false
    put(w, 'index.html', '<p>hi</p>\n')
    put(w, 'node_modules/x/index.js', 'big\n')
    put(w, '.git/HEAD', 'ref\n')
    await start($)
    await bash($, 'rm -rf "$OUT"')
    const archive = JSON.parse(w.files[`${folderOf(w)}/slot-0.tar`]!) as { name: string }[]
    expect(archive.map(e => e.name)).toEqual(['index.html'])
    expect(w.runs).toContain(`: tar -cf ${folderOf(w)}/pending-1.tar --exclude=.git --exclude=node_modules .`)
  })

  test('your always pattern saves the whole project; your ignore pattern saves nothing', { options: { always: 'prisma migrate', ignore: 'rm -rf dist' } }, async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    await start($)
    await bash($, 'npx prisma migrate reset')
    expect(indexOf(w).snapshots[0]?.scope).toBe('the project')
    await bash($, 'rm -rf dist')
    expect(indexOf(w).snapshots).toHaveLength(1)
  })

  test('a target outside the project is not saved, and the band says so', async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    await bash($, 'rm -rf ~/old')
    expect(indexOf(w).snapshots).toEqual([])
    expect(await bandTexts($)).toEqual([`mulligan: no do-over for "rm -rf ~/old": ${HOME}/old is outside the project.`])
  })

  test('a redirect to a file that does not exist yet has nothing to save', async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    await bash($, 'echo hi > new.txt')
    expect(indexOf(w).snapshots).toEqual([])
    expect(await bandTexts($)).toEqual([])
  })
})

describe('when it cannot, or should not, keep one', () => {
  test('a command held beneath (a safety hold) keeps no snapshot and draws no band', async ($, on) => {
    const w = world(on)
    project(w)
    w.isHeld = true
    await start($)
    const ran = await bash($, 'rm -rf dist')
    expect(ran.deny).toBe('held: waiting on the person')
    expect(indexOf(w).snapshots).toEqual([])
    expect(w.files[`${HOME}/.claude/mulligan`]).toBeUndefined()
    const pending = Object.keys(w.files).filter(path => path.includes('pending-'))
    for (const path of pending) expect(w.files[path]).toBe('')
    expect(await bandTexts($)).toEqual([])
  })

  test('a snapshot over the cap is skipped with a warning, and the command still runs', { options: { capMB: 1 } }, async ($, on) => {
    const w = world(on)
    put(w, 'data/big.bin', 'x'.repeat(1_200_000))
    await start($)
    await bash($, 'rm -rf data')
    expect(w.ran).toEqual(['rm -rf data'])
    expect(indexOf(w).snapshots).toEqual([])
    expect(await bandTexts($)).toEqual([expect.stringMatching(/^mulligan: too big to save \(1\.\d MB\); "rm -rf data" runs without a do-over\.$/)])
    for (const path of Object.keys(w.files).filter(p => p.endsWith('.tar'))) expect(w.files[path]).toBe('')
  })

  test('a tar that fails says so, and the command still runs', async ($, on) => {
    const w = world(on)
    project(w)
    w.tarFails = true
    await start($)
    await bash($, 'rm -rf dist')
    expect(w.ran).toEqual(['rm -rf dist'])
    expect(await bandTexts($)).toEqual(['mulligan: could not be saved; "rm -rf dist" runs without a do-over.'])
  })

  test(`only the last ${KEEP} stay; the slots are reused and an old archive is emptied`, async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    for (let i = 1; i <= KEEP + 2; i++) {
      put(w, `out${i}/f.txt`, `run ${i}\n`)
      await bash($, `rm -rf out${i}`)
    }
    const index = indexOf(w)
    expect(index.snapshots.map(s => s.n)).toEqual(Array.from({ length: KEEP }, (_, i) => i + 3))
    expect(index.next).toBe(KEEP + 3)
    const tars = Object.keys(w.files).filter(path => /slot-\d\.tar$/.test(path))
    expect(tars).toHaveLength(KEEP)
    expect(JSON.parse(w.files[`${folderOf(w)}/slot-0.tar`]!)[0].name).toBe('out11/f.txt')
  })

  test('every file it writes is under ~/.claude/mulligan, and every archive too', async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    w.untracked = ['dist/app.js']
    w.effects['rm -rf dist'] = w => rmTree(w, 'dist')
    await start($)
    await bash($, 'rm -rf dist')
    await bash($, 'git reset --hard && git clean -fd')
    await mulligan($, 'drop 1')
    const folder = `${HOME}/.claude/mulligan/`
    for (const path of w.writes) expect(path.startsWith(folder), path).toBe(true)
    for (const run of w.runs.filter(r => / tar -cf | mv /.test(r))) {
      for (const word of run.split(' ').filter(word => word.startsWith('/'))) expect(word.startsWith(folder), run).toBe(true)
    }
    // git never takes the index lock under Claude's own git commands.
    expect(w.runs.some(r => r.includes(': git '))).toBe(true)
    expect(w.lockingGit).toEqual([])
  })
})

describe('/mulligan', () => {
  test('lists the snapshots, newest first, on both surfaces; answers never reach Claude', async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    await start($)
    await bash($, 'rm -rf dist')
    await bash($, 'git reset --hard')
    expect((await mulligan($)).text).toBeUndefined()
    expect(w.opened).toEqual(['mulligan'])
    for (const surface of SURFACES) {
      const texts = await paneTexts($, surface)
      expect(texts.slice(0, 7), surface).toEqual(['2 do-overs for this project', '#2', 'git reset --hard', '    tracked changes · just now', '#1', 'rm -rf dist', expect.stringMatching(/^ {4}dist · \d+ B · just now$/)])
    }
  })

  test('restore waits on the confirm press; then files come back and Claude is told to re-read', async ($, on) => {
    const w = world(on)
    project(w)
    w.effects['rm -rf dist'] = w => rmTree(w, 'dist')
    await start($)
    await bash($, 'rm -rf dist')
    expect(w.files[`${ROOT}/dist/app.js`]).toBeUndefined()
    await mulligan($, 'restore 1')
    expect(w.files[`${ROOT}/dist/app.js`]).toBeUndefined() // nothing yet: only the press restores
    for (const surface of SURFACES) {
      const ui = await pane($, surface)
      const texts = (await ui.findAll({ type: 'Text' })).map(found => found.text)
      expect(texts, surface).toContain('Put back dist as it was before #1? Files it holds are written over what is there now; nothing newer is deleted.')
      expect((await ui.find({ key: 'cancel' }))?.props.autoFocus).toBe(true)
      await ui.unmount()
    }
    const ui = await pane($)
    await ui.press({ key: 'yes' })
    await ui.unmount()
    expect(w.files[`${ROOT}/dist/app.js`]).toBe('var a = 1\n')
    expect(w.appended).toEqual(['The person restored files in this project to how they were before the command `rm -rf dist` (mulligan snapshot 1). Files may differ from what you last read: re-read any file before editing it.'])
    expect(w.toasts.at(-1)).toBe('mulligan: restored #1 (dist). Claude was told to re-read files.')
  })

  test('restoring tracked changes runs git restore in overlay mode, so nothing newer is deleted', async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    w.effects['git reset --hard'] = w => put(w, 'src/app.ts', 'export const a = 0\n')
    await start($)
    await bash($, 'git reset --hard')
    await mulligan($, 'restore 1')
    const ui = await pane($)
    await ui.press({ key: 'yes' })
    await ui.unmount()
    expect(w.runs).toContain(`: git restore --overlay --source=${SHA} --worktree -- .`)
    expect(w.files[`${ROOT}/src/app.ts`]).toBe('export const a = 1\n')
  })

  test('Cancel restores nothing', async ($, on) => {
    const w = world(on)
    project(w)
    w.effects['rm -rf dist'] = w => rmTree(w, 'dist')
    await start($)
    await bash($, 'rm -rf dist')
    await mulligan($, 'restore 1')
    const ui = await pane($)
    await ui.press({ key: 'cancel' })
    expect(await ui.find({ key: 'yes' })).toBeUndefined()
    expect(w.files[`${ROOT}/dist/app.js`]).toBeUndefined()
    expect(w.appended).toEqual([])
  })

  test('diff lists exactly what differs now: deleted and changed files', async ($, on) => {
    const w = world(on)
    project(w)
    w.isDirty = true
    w.effects['rm -rf dist'] = w => {
      delete w.files[`${ROOT}/dist/app.js.map`]
      w.files[`${ROOT}/dist/app.js`] = 'var a = 2\n'
    }
    w.effects['git reset --hard'] = w => put(w, 'src/app.ts', 'export const a = 0\n')
    await start($)
    await bash($, 'rm -rf dist')
    await bash($, 'git reset --hard')
    await mulligan($, 'diff 1')
    expect(await paneTexts($)).toEqual(['#1 against the files now', 'changed: dist/app.js', 'deleted: dist/app.js.map'])
    await mulligan($, 'diff 2')
    expect(await paneTexts($)).toEqual(['#2 against the files now', 'changed: src/app.ts'])
  })

  test('drop runs only for the person, and empties its archive', async ($, on) => {
    const w = world(on)
    project(w)
    await start($)
    await bash($, 'rm -rf dist')
    await mulligan($, 'drop 1', { kind: 'plugin', name: 'other' })
    expect(w.toasts.at(-1)).toBe('mulligan: /mulligan drop runs only when you type it yourself.')
    expect(indexOf(w).snapshots).toHaveLength(1)
    await mulligan($, 'drop 1')
    expect(indexOf(w).snapshots).toEqual([])
    expect(w.files[`${folderOf(w)}/slot-0.tar`]).toBe('')
  })

  test('an unknown number, or no pane, is said in a toast', async ($, on) => {
    const w = world(on)
    project(w)
    w.isPanePlaced = false
    await start($)
    await mulligan($, 'restore 7')
    expect(w.toasts.at(-1)).toBe('mulligan: there is no snapshot 7 for this project. /mulligan lists them.')
    await bash($, 'rm -rf dist')
    await mulligan($, 'restore 1')
    expect(w.toasts.at(-1)).toBe('mulligan: a restore waits on a confirm in a pane, which only the terminal and the desktop app have.')
  })
})
