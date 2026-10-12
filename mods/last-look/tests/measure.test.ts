import { describe, expect, test } from 'claude-code/testing'

import type { LastLookItem, LastLookReport } from '../types'
import { classify } from '../hooks/classify'
import { COULD_NOT, holdTitle, measureAll, shouldHold, size } from '../hooks/measure'
import type { Ctx } from '../hooks/measure'
import { isAllowed, parseAllow } from '../hooks/paths'
import { clean } from '../hooks/text'
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

  test('a plain path that is not there still holds, saying nothing was found', async () => {
    const { item, hold, report } = await measure('rm -rf build', { files: { 'src/a.ts': { size: 1, git: 'clean' } } })
    expect(item.effect).toBe('nothing')
    expect(item.summary).toBe('Nothing found at these paths: build')
    expect(hold).toBe(true)
    expect(report.headline).toBe('Nothing found to destroy as far as it can tell: review it yourself')
  })

  test('a pattern that matches nothing could not be measured, and holds', async () => {
    const { item, hold } = await measure('rm -rf gen/*', { files: { 'src/a.ts': { size: 1, git: 'clean' } } })
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
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

  test('the run site refuses a find listing that writes, whatever built it', async () => {
    const world = makeWorld({ files: { 'a.md': { size: 1, git: 'clean' } } })
    const ctx: Ctx = { probe: world.probe, cwd: world.cwd, cwdReal: world.cwd, root: world.cwd, rootReal: world.cwd, home: world.home, allow: [], now: NOW }
    const dot = { text: '.', known: true, glob: false, raw: '.', plain: true }
    for (const writer of ['-fprint', '-fls', '-exec', '-delete']) {
      const report = await measureAll(ctx, 'find', [{ kind: 'find-delete', label: 'find', cd: [], targets: [dot], isSudo: false, findListing: ['.', writer, 'x'] }])
      expect(report.items[0]?.summary, writer).toBe(COULD_NOT)
    }
    expect(world.calls.filter(argv => argv[0] === 'find')).toHaveLength(0)
  })

  test('find that lists nothing could not be measured, and holds (the shell may run another find)', async () => {
    const { item, hold } = await measure('find . -name "*.pyc" -delete', { files: { 'c.py': { size: 1, git: 'clean' } } })
    expect(item.effect).toBe('unknown')
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
  })

  test('a find that writes (-fprint) is never re-run: held unmeasured', async () => {
    const { item, hold, world } = await measure('find . -name "*.md" -fprint notes.txt -delete', { files: { 'a.md': { size: 1, git: 'clean' } } })
    expect(item.summary).toBe(COULD_NOT)
    expect(hold).toBe(true)
    expect(world.calls.filter(argv => argv[0] === 'find')).toHaveLength(0)
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
    expect(none.item.effect).toBe('unknown')
    expect(none.hold).toBe(true)
  })

  test('git clean -ffdx dry-runs with both forces, so nested repositories show', async () => {
    const spec: WorldSpec = { files: { 'experiments/spike/a.py': { size: 2048, git: 'untracked' }, 'src/a.ts': { size: 1, git: 'clean' } }, nestedRepos: ['experiments/spike'] }
    const twice = await measure('git clean -ffdx', spec)
    expect(twice.hold).toBe(true)
    expect(twice.world.calls.some(argv => argv.join(' ').includes('clean -n -f -f -d -x'))).toBe(true)
    expect(twice.item.summary).toBe('Deletes 1 file, 2.0 KB')
    const once = await measure('git clean -fdx', spec)
    expect(once.hold).toBe(true)
    expect(once.rows).toContain('It skips the nested repository experiments/spike/.')
  })

  test('git clean names git quotes are read back as the files they are', async () => {
    const { item, hold } = await measure('git clean -f', { files: { 'notes "v2".md': { size: 1024, git: 'untracked' }, 'back\\slash.txt': { size: 1024, git: 'untracked' } } })
    expect(hold).toBe(true)
    expect(item.summary).toBe('Deletes 2 files, 2.0 KB')
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

  test('reset --hard on a clean tree still holds, saying nothing was found to lose', async () => {
    const { hold, item } = await measure('git reset --hard', { files: { 'a.ts': { size: 1, git: 'clean' } } })
    expect(hold).toBe(true)
    expect(item.effect).toBe('nothing')
  })

  test('line counts never come from git diff, which rewrites the index', async () => {
    const { world } = await measure('git reset --hard', { files: { 'a.ts': { size: 1, git: 'modified' } } })
    const sub = (argv: string[]) => argv[argv.indexOf('core.fsmonitor=false') + 1]
    expect(world.calls.some(argv => sub(argv) === 'diff-index')).toBe(true)
    expect(world.calls.some(argv => sub(argv) === 'diff')).toBe(false)
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

  test('a ref git cannot find could not be measured, and holds', async () => {
    const { hold, item } = await measure('git reset --hard nope', { files: { 'a.ts': { size: 1, git: 'modified' } } })
    expect(hold).toBe(true)
    expect(item.summary).toBe(COULD_NOT)
  })

  test('checkout of a branch passes; of a path, discards', async () => {
    const spec: WorldSpec = { files: { 'src/a.ts': { size: 1, git: 'modified' } }, git: { refs: ['refs/heads/main'] } }
    expect((await measure('git checkout main', spec)).hold).toBe(false)
    const path = await measure('git checkout src/a.ts', spec)
    expect(path.hold).toBe(true)
    expect(path.item.unsaved).toBe(1)
    const all = await measure('git checkout -- .', spec)
    expect(all.item.summary).toBe('Discards uncommitted changes in 1 file (+3 -1 lines)')
  })

  test('restore from the index keeps staged work: nothing to lose, still held', async () => {
    const spec: WorldSpec = { files: { 'a.ts': { size: 1, git: 'staged' } } }
    const index = await measure('git restore .', spec)
    expect(index.item.effect).toBe('nothing')
    expect(index.hold).toBe(true)
    const both = await measure('git restore -SW .', spec)
    expect(both.item.unsaved).toBe(1)
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
    expect((await measure('git branch -D ghost', { files: { 'a.ts': { size: 1, git: 'clean' } } })).hold).toBe(true)
  })

  test('outside a repo git commands could not be measured, and hold', async () => {
    expect((await measure('git reset --hard', { repo: null })).hold).toBe(true)
    expect((await measure('git push --force', { repo: null })).hold).toBe(true)
  })
})

describe('the two proven exceptions, and only on proof', () => {
  const files: WorldSpec['files'] = { 'src/a.ts': { size: 1, git: 'clean' } }

  test('a redirect to a plain path that does not exist passes', async () => {
    const { item, hold } = await measure('echo hi > new.txt', { files })
    expect(item.isHarmless).toBe(true)
    expect(hold).toBe(false)
    // Any other part in the command, even a cd, and it is held.
    expect((await measure('cd src && echo hi > new.txt', { files })).hold).toBe(true)
  })

  test('a lone redirect into a quoted here-doc passes', async () => {
    expect((await measure("cat > new.md <<'EOF'\nhello\nEOF", { files })).hold).toBe(false)
  })

  test('V-1: an earlier part can create the target, so the redirect is judged too early: held', async () => {
    const spec: WorldSpec = { files: { 'a.ts': { size: 100, git: 'modified' } } }
    expect((await measure('mv a.ts tmp && echo x > tmp', spec)).hold).toBe(true)
    expect((await measure('ln a.ts hard.txt; : > hard.txt', spec)).hold).toBe(true)
    expect((await measure('cat > new.md <<EOF\n$(rm -rf src)\nEOF', spec)).hold).toBe(true)
    expect((await measure('echo $(cp a.ts n.txt) > n.txt', spec)).hold).toBe(true)
  })

  test('a redirect holds without that proof', async () => {
    const cases: [string, WorldSpec][] = [
      ['echo hi > secret.txt', { files, unreadable: ['secret.txt'] }],
      ['echo hi > link.txt', { files, links: { 'link.txt': '/nowhere/x' } }],
      ['echo hi > linked.txt', { files: { ...files, 'real.txt': { size: 5, git: 'clean' } }, links: { 'linked.txt': '/work/app/real.txt' } }],
      ['echo hi > src', { files }],
      ['echo hi > ~/new.txt', { files }],
      ['echo hi > new{1,2}.txt', { files }],
      ['echo hi > ../new.txt', { files }],
      ['echo hi > new*.txt', { files }],
      ['echo hi > "$OUT"', { files }],
      ['echo hi > $(date).log', { files }],
      ['cd "$D" && echo hi > new.txt', { files }],
    ]
    for (const [command, spec] of cases) expect((await measure(command, spec)).hold, command).toBe(true)
  })

  const branches: WorldSpec = { files, git: { refs: ['refs/heads/main', 'refs/remotes/origin/feature', 'v1'] } }

  test('git checkout of a branch git confirms passes', async () => {
    for (const command of ['git checkout main', 'git checkout feature', 'git checkout origin/feature', 'git checkout -q main', 'git checkout --track origin/feature']) {
      expect((await measure(command, branches)).hold, command).toBe(false)
    }
  })

  test('git checkout holds without that proof', async () => {
    const cases: [string, WorldSpec][] = [
      ['git checkout -f main', branches],
      ['git checkout --force main', branches],
      ['git checkout main -- src/a.ts', branches],
      ['git checkout -m main', branches],
      ['git checkout v1', branches],
      ['git checkout ghost', branches],
      ['git checkout "$B"', branches],
      ['git checkout main', { ...branches, fail: /^git\b/ }],
      ['git checkout main', { ...branches, repo: null }],
      ['git checkout main', { ...branches, files: { ...files, main: { size: 1, git: 'clean' } } }],
      ['git checkout main', { ...branches, unreadable: ['main'] }],
      ['git checkout feature', { files, git: { refs: ['refs/remotes/origin/feature', 'refs/remotes/upstream/feature'] } }],
    ]
    for (const [command, spec] of cases) expect((await measure(command, spec)).hold, command).toBe(true)
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

  test('V-2: alwaysAllow never covers find (links may lead out), nor redirects', async () => {
    const linked: WorldSpec = { ...spec, files: { ...spec.files, 'dist/b.js': { size: 1, git: 'ignored' } } }
    for (const command of ['find dist -delete', 'find -L dist -delete', 'find dist -follow -delete', 'find -H dist -name "*.js" -delete', 'echo x > dist/a.js']) {
      expect((await measure(command, linked, DEFAULT_ALLOW)).hold, command).toBe(true)
    }
  })

  test('without the setting the same command holds', async () => {
    expect((await measure('rm -rf dist', spec, '')).hold).toBe(true)
  })

  test('only plain literal paths are allowed: quotes and ./ yes; globs, braces, ~, $VAR no', async () => {
    expect((await measure('rm -rf "dist"', spec, DEFAULT_ALLOW)).hold).toBe(false)
    expect((await measure('rm -rf ./dist', spec, DEFAULT_ALLOW)).hold).toBe(false)
    expect((await measure('rm -rf dist/*', spec, DEFAULT_ALLOW)).hold).toBe(true)
    expect((await measure('rm -rf {dist,packages/web/dist}', spec, DEFAULT_ALLOW)).hold).toBe(true)
    expect((await measure('D=dist; rm -rf "$D"', spec, DEFAULT_ALLOW)).hold).toBe(true)
    expect((await measure('rm -rf packages/../dist', spec, DEFAULT_ALLOW)).hold).toBe(true)
    expect((await measure('rm -rf ~/app/dist', { ...spec, cwd: '/Users/me/app' }, DEFAULT_ALLOW)).hold).toBe(true)
  })

  test('an allowed folder that is not there holds (nothing to judge its real path by)', async () => {
    expect((await measure('rm -rf coverage', spec, DEFAULT_ALLOW)).hold).toBe(true)
  })

  test('an allowed name that is a link out of the project holds', async () => {
    const linked: WorldSpec = { files: { '/Users/me/Documents/taxes.pdf': { size: 1024 } }, links: { dist: '/Users/me/Documents' } }
    const { hold, item } = await measure('rm -rf dist/', linked, DEFAULT_ALLOW)
    expect(item.isAllowed).toBe(false)
    expect(hold).toBe(true)
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

test('clean() leaves one drawable line', () => {
  expect(clean('plain text')).toBe('plain text')
  expect(clean('\u001b[31mred\u001b[0m')).toBe('red')
  expect(clean('\u001b]0;title\u0007after')).toBe('after')
  expect(clean('\u009b2Jx')).toBe('x')
  expect(clean('a\nb\tc\rd')).toBe('a b c d')
  expect(clean('\u0000\u0007\u007f\u0085')).toBe('\uFFFD\uFFFD\uFFFD\uFFFD')
  expect(clean('caf\u00e9 \u65e5\u672c')).toBe('caf\u00e9 \u65e5\u672c')
  expect(clean('\u001b')).toBe('')
})

// A held command the measurement found nothing in (or could not finish) is held
// for review in neutral words; "can destroy work" only when there is work to lose.
describe('holdTitle', () => {
  const part = (over: Partial<LastLookItem>): LastLookItem =>
    ({ files: 0, bytes: 0, unsaved: 0, commits: 0, isAllowed: false, isHarmless: false, isCatastrophic: false, effect: 'unknown', ...over }) as LastLookItem
  test('work to lose: can destroy work', () => {
    for (const found of [{ files: 3 }, { unsaved: 1 }, { commits: 2 }, { isCatastrophic: true }]) {
      expect(holdTitle([part(found)])).toBe('Held: this command can destroy work')
    }
  })
  test('nothing found, or not measured: held for your review', () => {
    expect(holdTitle([part({ effect: 'unknown' })])).toBe('Held for your review')
    expect(holdTitle([part({ effect: 'nothing' })])).toBe('Held for your review')
    expect(holdTitle([])).toBe('Held for your review')
  })
  test('allowed or harmless parts never count as work to lose', () => {
    expect(holdTitle([part({ files: 5, isAllowed: true }), part({ files: 2, isHarmless: true })])).toBe('Held for your review')
  })
})
