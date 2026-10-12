// Once the classifier calls a command destructive it holds, whatever the
// measurement found or failed to find. Every form below must hold, the
// review's reproduced fail-opens included (marked "review:"), and no command
// the mod runs to measure may ever write or execute.

import { describe, expect, test } from 'claude-code/testing'

import type { LastLookItem } from '../types'
import { classify } from '../hooks/classify'
import { measureAll, shouldHold } from '../hooks/measure'
import type { Ctx } from '../hooks/measure'
import { parseAllow } from '../hooks/paths'
import { FIND_WRITERS, NOW, isReadOnly, makeWorld } from './world'
import type { WorldSpec } from './world'

const DEFAULT_ALLOW = 'dist,build,.next,coverage,node_modules/.cache'

const WORLD: WorldSpec = {
  files: {
    'src/a.ts': { size: 100, git: 'modified' },
    'src/b.ts': { size: 100, git: 'untracked' },
    'src/c.ts': { size: 100, git: 'clean' },
    'out/x.js': { size: 1000, git: 'ignored' },
    'web/out/y.js': { size: 1000, git: 'ignored' },
    'web/build/z.js': { size: 1000, git: 'untracked' },
    'cache/a.pyc': { size: 10, git: 'untracked' },
    'cache/b.pyo': { size: 10, git: 'untracked' },
    'pkgs/a/b/notes/n.md': { size: 10, git: 'untracked' },
    'h8/x.txt': { size: 10, git: 'clean' },
    'h9/y.txt': { size: 10, git: 'modified' },
    'notes "v2".md': { size: 10, git: 'untracked' },
    'back\\slash.txt': { size: 10, git: 'untracked' },
    'experiments/spike/a.py': { size: 10, git: 'untracked' },
    '/work/elsewhere/data/keep.txt': { size: 10 },
  },
  links: { linkdist: '/work/elsewhere/sub' },
  dirs: ['/work/elsewhere/sub'],
  nestedRepos: ['experiments/spike'],
  git: {
    refs: ['HEAD~3', 'main', 'refs/remotes/origin/main', 'refs/heads/feature'],
    upstream: 'origin/main',
    ranges: { 'HEAD~3..HEAD': ['a1 one', 'b2 two', 'c3 three'], 'HEAD..refs/remotes/origin/main': ['d4 Ana: teammate fix'], 'only:feature': ['e5 wip'] },
  },
}

const DESTRUCTIVE: string[] = [
  // rm, every spelling
  'rm -rf src', 'rm -r src', 'rm -fr src', 'rm -Rf src', 'rm -f -r src', 'rm --recursive --force src', 'rm --rec src',
  'rm src -rf', 'sudo rm -rf src', 'sudo -u root rm -rf src', 'env -i PATH=/bin rm -rf src', 'FOO=1 rm -rf src',
  '\\rm -rf src', '/bin/rm -rf src', '"rm" -rf src', 'command rm -rf src', 'nohup nice -n 5 rm -rf src',
  'timeout 30 rm -rf src', 'time rm -rf src', 'cd web && rm -rf out', 'npm run clean; rm -rf out', '(cd web && rm -rf out)',
  '{ cd web; rm -rf out; }', 'if [ -d src ]; then rm -rf src; fi', 'for d in src out; do rm -rf "$d"; done',
  'bash -c "rm -rf src"', "sh -lc 'cd web && rm -rf out'", 'eval rm -rf src', 'echo $(rm -rf src)', 'rm -rf {src,out}',
  'rm -rf ~/scratch', 'rm -rf ./src/*', 'function clean { rm -rf src; }', 'rm -rf missing-folder', 'rm -rf src &',
  // find
  'find . -name "*.pyc" -delete', 'find . -type d -name x -exec rm -rf {} +', 'find src -name "*.ts" -exec rm {} \\;',
  'find . -name x -exec sudo rm -rf {} +', "find . -name x -exec sh -c 'rm -rf \"$1\"' _ {} \\;",
  'find . -name "*.nothing" -delete', 'find . | xargs rm -rf', 'find . -name "*.log" -print0 | xargs -0 rm -f',
  // git
  'git clean -fd', 'git clean -fdx', 'git clean -f', 'git clean -f -f -d',
  'git reset --hard', 'git reset --hard HEAD~3', 'git -C web reset --hard', 'git checkout -- .', 'git checkout .',
  'git checkout -- src/a.ts', 'git checkout HEAD -- src/a.ts', 'git checkout -f', 'git checkout src/a.ts', 'git restore .',
  'git restore -SW .', 'git switch --discard-changes main', 'git push --force', 'git push -f origin main', 'git push origin +main',
  'git push --mirror', 'git branch -D feature', 'git branch -D ghost', 'git branch --merged | xargs git branch -D',
  'git reset --hard nope', 'git restore --staged --worktree src/c.ts',
  // overwriting redirects
  'echo hi > src/c.ts', 'cat src/a.ts > src/c.ts', 'npm test 2> src/c.ts', 'make &> src/c.ts', ': > src/a.ts', 'echo x > "$OUT"',
  'echo x > linkdist/../data/keep.txt',
  // review: the reproduced fail-opens, each now held
  'git clean -ffdx',
  "find cache -regex '.*\\.\\(pyc\\|pyo\\)' -delete",
  "find cache -readable -name '*.pyc' -delete",
  'rm -rf **/notes',
  'rm -rf h{8..9}',
  'rm -rf {a,b,c,d,e,f,g,h}{1,2,3,4,5,6,7,8,9}',
  'cd -- web && rm -rf out',
  'cd web & rm -rf web',
  'rm -rf linkdist/../data',
  'cd linkdist && rm -rf ../data',
  'T="src cache"; rm -rf $T',
  "P='*'; rm -rf $P",
  'git push --force --force-with-lease',
  'find web -name "*.md" -fprint web/build/notes.md -delete',
  `X=${'{a,b}'.repeat(23)}; rm -rf src`,
  // review 2: V-1, V-2, V-3, each now held
  'mv src/a.ts tmp && echo x > tmp',
  'ln src/a.ts hard.txt; : > hard.txt',
  'find -L out -delete',
  'find out -follow -delete',
  'find -H out -delete',
  'git branch -D -- feature',
  'git checkout -- src/a.ts',
  'git restore -- src/a.ts',
  'git clean -fd -- src',
  'git reset --hard --',
  'git push --force -- origin main',
  'git worktree remove --force ../wt',
  'git worktree remove -f ../wt',
]

async function measured(command: string, allow = DEFAULT_ALLOW, spec: WorldSpec = WORLD) {
  const world = makeWorld(spec)
  const ctx: Ctx = { probe: world.probe, cwd: world.cwd, cwdReal: world.cwd, root: world.cwd, rootReal: world.cwd, home: world.home, allow: parseAllow(allow), now: NOW }
  const findings = classify(command, { home: world.home })
  const report = await measureAll(ctx, command, findings)
  return { findings, report, world, item: report.items[0] as LastLookItem }
}

describe('every destructive form holds', () => {
  test(`${DESTRUCTIVE.length} forms, the review's fail-opens among them`, async () => {
    expect(DESTRUCTIVE.length).toBeGreaterThanOrEqual(60)
    for (const command of DESTRUCTIVE) {
      const { findings, report, world } = await measured(command)
      expect(findings.length, `classified: ${command}`).toBeGreaterThan(0)
      expect(shouldHold(report), `held: ${command}`).toBe(true)
      for (const argv of world.calls) {
        expect(isReadOnly(argv), `read-only (${command}): ${argv.join(' ')}`).toBe(true)
        for (const t of argv) expect(FIND_WRITERS.includes(t) && argv[0] === 'find', `no writing find predicate (${command})`).toBe(false)
      }
    }
  })

  test('and with alwaysAllow emptied too', async () => {
    for (const command of DESTRUCTIVE) expect(shouldHold((await measured(command, '')).report), command).toBe(true)
  })
})

describe('review replays, in detail', () => {
  test('git clean -ffdx dry-runs with both forces and lists the nested repository', async () => {
    const { world, report } = await measured('git clean -ffdx', DEFAULT_ALLOW, { files: { 'experiments/spike/a.py': { size: 10, git: 'untracked' }, 'src/c.ts': { size: 1, git: 'clean' } }, nestedRepos: ['experiments/spike'] })
    expect(world.calls.some(argv => argv.join(' ').includes('clean -n -f -f -d -x'))).toBe(true)
    expect(shouldHold(report)).toBe(true)
    expect(report.items[0]?.files).toBe(1)
  })

  test('brace ranges are expanded and measured: h9 holds unsaved work', async () => {
    const { item } = await measured('rm -rf h{8..9}')
    expect(item.unsaved).toBe(1)
    expect(item.files).toBe(2)
  })

  test('a 72-way brace list is measured whole, never cut at 64', async () => {
    const { item } = await measured('rm -rf {a,b,c,d,e,f,g,h}{1,2,3,4,5,6,7,8,9}', DEFAULT_ALLOW, { files: { 'h9/keep.txt': { size: 10, git: 'modified' } } })
    expect(item.unsaved).toBe(1)
  })

  test('-fprint is never copied into a measuring find', async () => {
    const { world } = await measured('find web -name "*.md" -fprint web/build/notes.md -delete')
    expect(world.calls.filter(argv => argv[0] === 'find')).toHaveLength(0)
  })

  test('names git clean quotes are measured as the files they are', async () => {
    const { item } = await measured('git clean -f', DEFAULT_ALLOW, { files: { 'notes "v2".md': { size: 1024, git: 'untracked' }, 'back\\slash.txt': { size: 1024, git: 'untracked' } } })
    expect(item.files).toBe(2)
  })

  test('a lease beside --force does not stop the hold, and it shows the teammate commit', async () => {
    const { item } = await measured('git push --force --force-with-lease')
    expect(item.commits).toBe(1)
  })
})
