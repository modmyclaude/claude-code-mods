import { describe, expect, test } from 'claude-code/testing'

import type { LastLookItem, LastLookReport } from '../types'
import { classify } from '../hooks/classify'
import { COULD_NOT, measureAll, shouldHold, size } from '../hooks/measure'
import type { Ctx } from '../hooks/measure'
import { isAllowed, parseAllow } from '../hooks/paths'
import { NOW, isReadOnly, makeWorld } from './world'
import type { WorldSpec } from './world'

const DEFAULT_ALLOW = 'dist,build,.next,coverage,node_modules/.cache'

async function measure(command: string, spec: WorldSpec = {}, allow = '') {
  const world = makeWorld(spec)
  const ctx: Ctx = { probe: world.probe, cwd: world.cwd, cwdReal: world.cwd, root: world.cwd, rootReal: world.cwd, home: world.home, allow: parseAllow(allow), now: NOW }
  const report: LastLookReport = await measureAll(ctx, command, classify(command, { home: world.home }))
  // Whatever happened, only read-only commands ran.
  for (const argv of world.calls) expect(isReadOnly(argv), `read-only: ${argv.join(' ')}`).toBe(true)
  const item = report.items[0] as LastLookItem
  const rows = item.rows.map(r => r.text)
  return { report, item, rows, world, hold: shouldHold(report) }
}

describe('deleting files', () => {
  test('rm -rf counts the files and their size', async () => {
    const { item, rows, hold, report } = await measure('rm -rf build', {
      files: { 'build/app.js': { size: 2048, git: 'ignored' }, 'build/app.js.map': { size: 1024, git: 'ignored' }, 'src/keep.ts': { size: 9, git: 'clean' } },
    })
    expect(hold).toBe(true)
    expect(item.summary).toBe('Deletes 2 files, 3.0 KB')
    expect(item.files).toBe(2)
    expect(item.unsaved).toBe(0)
    expect(rows).toContain('build/app.js')
    expect(rows).toContain('build/app.js.map')
    expect(rows.join('\n')).not.toContain('keep.ts')
    expect(report.headline).toBe('It would delete or overwrite 2 files (3.0 KB)')
  })

  test('files with uncommitted work are called out first', async () => {
    const { item, rows, report } = await measure('rm -rf src', {
      files: { 'src/a.ts': { size: 10, git: 'modified' }, 'src/b.ts': { size: 10, git: 'untracked' }, 'src/c.ts': { size: 10, git: 'clean' } },
    })
    expect(item.unsaved).toBe(2)
    expect(report.headline).toBe('2 files have unsaved work you would lose')
    expect(report.headlineTone).toBe('error')
    const lost = rows.indexOf('2 files have unsaved work you would lose:')
    expect(lost).toBeGreaterThanOrEqual(0)
    expect(rows).toContain('  src/a.ts  (modified)')
    expect(rows).toContain('  src/b.ts  (never added to git)')
    expect(rows).toContain('git can restore the last committed version of 2 tracked files')
    // The list shows the rest after the unsaved ones, never twice.
    expect(rows.filter(r => r.includes('src/a.ts'))).toHaveLength(1)
  })

  test('outside git it says nothing can come back', async () => {
    const { rows } = await measure('rm -rf notes', { repo: null, files: { 'notes/a.md': { size: 5 } } })
    expect(rows).toContain('Not in a git repository: git cannot bring back any of this.')
  })

  test('a target that is not there is nothing to hold', async () => {
    const { item, hold } = await measure('rm -rf build', { files: { 'src/a.ts': { size: 1, git: 'clean' } } })
    expect(item.effect).toBe('nothing')
    expect(hold).toBe(false)
  })

  test('measures relative to the cd target', async () => {
    const { item } = await measure('cd web && rm -rf build', { files: { 'web/build/x.js': { size: 4096, git: 'ignored' }, 'build/other.js': { size: 1, git: 'ignored' } } })
    expect(item.where).toBe('web')
    expect(item.summary).toBe('Deletes 1 file, 4.0 KB')
  })

  test('a cd that would fail (and ; carries on) measures where the shell already is', async () => {
    const { item, rows } = await measure('cd nowhere; rm -rf build', { files: { 'build/x.js': { size: 1024, git: 'ignored' } } })
    expect(item.summary).toBe('Deletes 1 file, 1.0 KB')
    expect(rows[0]).toBe('cd nowhere would fail, so this would run in .')
  })

  test('globs are expanded as the shell would, hidden files left out', async () => {
    const { item, rows } = await measure('rm -rf cache/*', {
      files: { 'cache/a/1.bin': { size: 1024 }, 'cache/b.bin': { size: 1024 }, 'cache/.keep': { size: 0 } },
      repo: null,
    })
    expect(item.files).toBe(2)
    expect(rows.join('\n')).not.toContain('.keep')
  })

  test('your home folder or a system folder is never walked', async () => {
    const { item, world } = await measure('rm -rf ~', { files: { '/Users/me/a.txt': { size: 1 } } })
    expect(item.summary).toContain('your home folder or a system folder')
    expect(item.summaryTone).toBe('error')
    expect(world.calls.filter(argv => argv[0] === 'find' || argv[0] === 'du')).toHaveLength(0)
    expect((await measure('sudo rm -rf /usr', { dirs: ['/usr/bin'] })).item.summary).toContain('system folder')
  })

  test('find -delete is re-run as a listing, never with -delete', async () => {
    const { item, world, report } = await measure('find . -name "*.pyc" -delete', {
      files: { 'a.pyc': { size: 10, git: 'untracked' }, 'sub/b.pyc': { size: 10, git: 'clean' }, 'c.py': { size: 10, git: 'clean' } },
    })
    expect(item.summary).toMatch(/^Deletes 2 paths/)
    expect(item.unsaved).toBe(1)
    expect(report.headline).toBe('1 file has unsaved work you would lose')
    const listing = world.calls.find(argv => argv[0] === 'find')
    expect(listing).toEqual(['find', '.', '-depth', '-name', '*.pyc', '-print0'])
  })

  test('find that matches nothing passes', async () => {
    const { item, hold } = await measure('find . -name "*.pyc" -delete', { files: { 'c.py': { size: 1, git: 'clean' } } })
    expect(item.effect).toBe('nothing')
    expect(hold).toBe(false)
  })

  test('git clean is measured from its own dry run', async () => {
    const spec: WorldSpec = { files: { 'x.tmp': { size: 2048, git: 'untracked' }, 'dist/a.js': { size: 1024, git: 'ignored' }, 'src/a.ts': { size: 1, git: 'clean' } } }
    const plain = await measure('git clean -fd', spec)
    expect(plain.item.summary).toBe('Deletes 1 file, 2.0 KB')
    expect(plain.item.unsaved).toBe(1)
    expect(plain.world.calls.some(argv => argv.includes('clean') && argv.includes('-n') && argv.includes('-d'))).toBe(true)
    const all = await measure('git clean -fdx', spec)
    expect(all.item.files).toBe(2)
    expect(all.item.unsaved).toBe(1)
    const none = await measure('git clean -fd', { files: { 'src/a.ts': { size: 1, git: 'clean' } } })
    expect(none.item.effect).toBe('nothing')
  })
})

describe('overwriting a file', () => {
  test('an existing tracked file: git can restore it', async () => {
    const { item, rows, hold } = await measure('echo hi > notes.txt', { files: { 'notes.txt': { size: 12, git: 'clean' } } })
    expect(hold).toBe(true)
    expect(item.summary).toBe('Overwrites notes.txt (12 B)')
    expect(rows).toContain('git can restore it as last committed.')
  })

  test('a file with unsaved work', async () => {
    const { item, report } = await measure('cat a > notes.txt', { files: { 'notes.txt': { size: 12, git: 'modified' } } })
    expect(item.unsaved).toBe(1)
    expect(report.headline).toBe('1 file has unsaved work you would lose')
  })

  test('a new file is nothing to hold; nor is >>', async () => {
    expect((await measure('echo hi > new.txt')).hold).toBe(false)
    expect(classify('echo hi >> notes.txt')).toHaveLength(0)
  })

  test('an ignored file is gone for good', async () => {
    const { rows } = await measure('echo x > .env.local', { files: { '.env.local': { size: 40, git: 'ignored' } } })
    expect(rows).toContain('git ignores it: its old contents would be gone for good.')
  })
})

describe('git history', () => {
  test('reset --hard lists the changes it discards', async () => {
    const { item, report } = await measure('git reset --hard', { files: { 'a.ts': { size: 1, git: 'modified' }, 'b.ts': { size: 1, git: 'staged' }, 'c.ts': { size: 1, git: 'untracked' } } })
    expect(item.summary).toBe('Discards uncommitted changes in 2 files (+6 -2 lines)')
    expect(item.unsaved).toBe(2)
    expect(report.headline).toBe('2 files have unsaved work you would lose')
  })

  test('reset --hard on a clean tree passes', async () => {
    const { hold } = await measure('git reset --hard', { files: { 'a.ts': { size: 1, git: 'clean' } } })
    expect(hold).toBe(false)
  })

  test('reset --hard to an older commit names the commits it drops', async () => {
    const { item, rows, report } = await measure('git reset --hard HEAD~2', {
      files: { 'a.ts': { size: 1, git: 'clean' } },
      git: { refs: ['HEAD~2'], ranges: { 'HEAD~2..HEAD': ['a1b2c3d Fix login', 'e4f5a6b Add tests'] } },
    })
    expect(item.commits).toBe(2)
    expect(report.headline).toBe('2 commits would be lost')
    expect(rows).toContain('  a1b2c3d Fix login')
    expect(item.summary).toBe('Drops 2 commits from main')
  })

  test('a ref git cannot find means the reset would fail', async () => {
    const { hold } = await measure('git reset --hard nope', { files: { 'a.ts': { size: 1, git: 'modified' } } })
    expect(hold).toBe(false)
  })

  test('checkout of a branch passes; of a path, discards', async () => {
    const spec: WorldSpec = { files: { 'src/a.ts': { size: 1, git: 'modified' } }, git: { refs: ['main'] } }
    expect((await measure('git checkout main', spec)).hold).toBe(false)
    const path = await measure('git checkout src/a.ts', spec)
    expect(path.hold).toBe(true)
    expect(path.item.unsaved).toBe(1)
    const all = await measure('git checkout -- .', spec)
    expect(all.item.summary).toBe('Discards uncommitted changes in 1 file (+3 -1 lines)')
  })

  test('restore from the index keeps staged work', async () => {
    const spec: WorldSpec = { files: { 'a.ts': { size: 1, git: 'staged' } } }
    expect((await measure('git restore .', spec)).hold).toBe(false)
    expect((await measure('git restore -SW .', spec)).hold).toBe(true)
  })

  test('push --force names the commits it would overwrite, as of the last fetch', async () => {
    const { item, rows, report, hold } = await measure('git push --force', {
      files: { 'a.ts': { size: 1, git: 'clean' } },
      git: { upstream: 'origin/main', refs: ['refs/remotes/origin/main'], ranges: { 'HEAD..refs/remotes/origin/main': ['abc1234 Ana: Fix the build'] }, fetchedAt: NOW - 2 * 3600_000 },
    })
    expect(hold).toBe(true)
    expect(item.commits).toBe(1)
    expect(item.summary).toBe('Overwrites origin/main: 1 commit there would be lost')
    expect(rows).toContain('  abc1234 Ana: Fix the build')
    expect(rows).toContain('As of your last fetch (2 h ago); the remote may have moved since.')
    expect(report.headline).toBe('1 commit would be lost')
  })

  test('push --force with nothing to lose still holds: the remote may have moved', async () => {
    const { item, hold } = await measure('git push -f origin feature', { files: { 'a.ts': { size: 1, git: 'clean' } }, git: { refs: ['refs/remotes/origin/feature'] } })
    expect(hold).toBe(true)
    expect(item.summary).toBe('Force-pushes origin/feature; no commits would be lost as of your last fetch')
  })

  test('push --force with no upstream cannot be measured', async () => {
    const { item, hold } = await measure('git push --force', { files: { 'a.ts': { size: 1, git: 'clean' } } })
    expect(item.effect).toBe('unknown')
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
  })

  test('branch -D counts the commits that live only there', async () => {
    const { item, report } = await measure('git branch -D feature', {
      files: { 'a.ts': { size: 1, git: 'clean' } },
      git: { refs: ['refs/heads/feature'], ranges: { 'only:feature': ['1111111 WIP', '2222222 More WIP', '3333333 Done'] } },
    })
    expect(item.commits).toBe(3)
    expect(item.summary).toBe('Deletes feature: 3 commits exist nowhere else')
    expect(report.headline).toBe('3 commits would be lost')
    expect((await measure('git branch -D ghost', { files: { 'a.ts': { size: 1, git: 'clean' } } })).hold).toBe(false)
  })

  test('outside a repo git commands would fail, so nothing is held', async () => {
    expect((await measure('git reset --hard', { repo: null })).hold).toBe(false)
    expect((await measure('git push --force', { repo: null })).hold).toBe(false)
  })
})

describe('alwaysAllow', () => {
  const spec: WorldSpec = { files: { 'dist/a.js': { size: 10, git: 'ignored' }, 'src/a.ts': { size: 1, git: 'modified' }, 'packages/web/dist/b.js': { size: 1, git: 'ignored' } } }

  test('every target inside an allowed folder passes, without walking it', async () => {
    const { item, hold, world } = await measure('rm -rf dist', spec, DEFAULT_ALLOW)
    expect(item.isAllowed).toBe(true)
    expect(hold).toBe(false)
    expect(world.calls).toHaveLength(0)
    expect((await measure('rm -rf packages/web/dist', spec, DEFAULT_ALLOW)).hold).toBe(false)
  })

  test('one target outside is enough to hold', async () => {
    expect((await measure('rm -rf dist src', spec, DEFAULT_ALLOW)).hold).toBe(true)
    expect((await measure('rm -rf dist && rm -rf src', spec, DEFAULT_ALLOW)).hold).toBe(true)
  })

  test('without the setting the same command holds', async () => {
    expect((await measure('rm -rf dist', spec, '')).hold).toBe(true)
  })

  test('the match is by folder name beneath the project, never the root or outside', () => {
    const allow = parseAllow(` dist , ./build/, node_modules/.cache, .., ,`)
    expect(allow).toEqual(['dist', 'build', 'node_modules/.cache'])
    const root = '/work/app'
    expect(isAllowed('/work/app/dist', root, allow)).toBe(true)
    expect(isAllowed('/work/app/dist/x/y', root, allow)).toBe(true)
    expect(isAllowed('/work/app/a/build', root, allow)).toBe(true)
    expect(isAllowed('/work/app/node_modules/.cache/x', root, allow)).toBe(true)
    expect(isAllowed('/work/app/node_modules', root, allow)).toBe(false)
    expect(isAllowed('/work/app/distro', root, allow)).toBe(false)
    expect(isAllowed('/work/app', root, allow)).toBe(false)
    expect(isAllowed('/work/other/dist', root, allow)).toBe(false)
    expect(isAllowed('/tmp/x', root, ['/tmp'])).toBe(true)
  })
})

describe('what cannot be measured is still held', () => {
  test('a path only known at run time', async () => {
    const { item, hold, report } = await measure('rm -rf "$OUT"')
    expect(item.effect).toBe('unknown')
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
    expect(report.headline).toBe('Could not measure all of it: review it yourself')
  })

  test('xargs rm', async () => {
    const { item, hold } = await measure('find . -name "*.log" | xargs rm')
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
  })

  test('find and du failing to run', async () => {
    const { item, hold } = await measure('rm -rf build', { files: { 'build/a.js': { size: 1, git: 'ignored' } }, fail: /^(find|du)\b/ })
    expect(item.effect).toBe('unknown')
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
  })

  test('git failing to run leaves a warning, not a pass', async () => {
    const { rows, hold } = await measure('rm -rf src', { files: { 'src/a.ts': { size: 1, git: 'modified' } }, fail: /^git\b/ })
    expect(hold).toBe(true)
    expect(rows).toContain('git status failed, so unsaved work could not be checked.')
  })

  test('git failing on reset is unmeasured, and held', async () => {
    const { item, hold } = await measure('git reset --hard', { files: { 'a.ts': { size: 1, git: 'modified' } }, fail: /^git\b/ })
    expect(item.effect).toBe('unknown')
    expect(hold).toBe(true)
  })

  test('past eight parts the rest are held unmeasured', async () => {
    const command = Array.from({ length: 10 }, (_, k) => `rm -rf "$D${k}"`).join('; ')
    const { report } = await measure(command)
    expect(report.items).toHaveLength(9)
    expect(report.items[8]?.title).toBe('2 more destructive steps')
  })
})

test('sizes read like a person would say them', () => {
  expect(size(0)).toBe('0 B')
  expect(size(1023)).toBe('1023 B')
  expect(size(1024)).toBe('1.0 KB')
  expect(size(1536 * 1024)).toBe('1.5 MB')
  expect(size(3 * 1024 ** 3)).toBe('3.0 GB')
})
