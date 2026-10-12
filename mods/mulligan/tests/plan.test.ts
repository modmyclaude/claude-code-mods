// The plan on its own: which commands take a snapshot, of what, and the words.

import { describe, expect, test } from 'claude-code/testing'

import { classify } from '../hooks/classify'
import { agoWords, outermost, planFor, projectKey, restoreNote, scopeWords, sizeWords, staticPart } from '../hooks/plan'

const ROOT = '/work/app'
const HOME = '/home/me'
const plan = (command: string, isGit = true, cwd = ROOT) => planFor(classify(command, { home: HOME }), cwd, ROOT, isGit)

describe('which commands save first', () => {
  // The same shapes last-look holds: each must plan a snapshot.
  const RISKY = [
    'rm -rf dist',
    'rm -r build',
    'rm -fr build',
    'rm --recursive --force build',
    'sudo rm -rf build',
    'FOO=1 rm -rf build',
    '/bin/rm -rf build',
    'cd web && rm -rf build',
    'npm run clean; rm -rf dist',
    '(cd web && rm -rf build)',
    'bash -c "rm -rf build"',
    "sh -lc 'cd web && rm -rf .next'",
    'rm -rf {dist,build}',
    'rm -rf ./build/*',
    'rm -rf "$OUT"',
    'find . -name "*.pyc" -delete',
    'find build -name "*.map" -exec rm {} \\;',
    'find . -name x | xargs rm -rf',
    'git clean -fd',
    'git clean -ffdx',
    'git reset --hard',
    'git reset --hard HEAD~3',
    'git checkout -- .',
    'git checkout src/app.ts',
    'git restore .',
    'git restore --source=HEAD~2 src/app.ts',
    'git switch --discard-changes main',
    'echo hi > notes.txt',
    'cat config.json > backup.json',
    "cat > notes.md <<'EOF'\nhello\nEOF",
  ]
  for (const command of RISKY) {
    test(`saves first: ${command.replace(/\n/g, '\\n').slice(0, 50)}`, () => {
      expect(plan(command)).not.toBeNull()
    })
  }

  // Look-alikes and commands that touch no file here: no snapshot.
  const BENIGN = [
    'ls -la',
    'rm file.txt',
    'rm -f file.txt',
    'echo "rm -rf build"',
    "grep -r 'rm -rf' .",
    'git status',
    'git diff',
    'git log --oneline',
    'git checkout -b feature',
    'git stash',
    'git commit -m "x"',
    'git push origin main',
    'git push --force',
    'git branch -D feature',
    'npm test',
    'npm install',
    'cat README.md',
    'mkdir -p build',
    'cp a b',
    'find . -name "*.ts"',
    'find . -name "*.ts" -print',
    'echo hi',
    'echo hi >> log.txt',
    'ls > /dev/null',
    'make 2>&1 | tee /dev/null',
    'tsc --noEmit',
    'node index.js',
    'python3 -m pytest',
    'docker ps',
    'curl -s https://example.com',
  ]
  for (const command of BENIGN) {
    test(`no snapshot: ${command}`, () => {
      expect(plan(command)).toBeNull()
    })
  }
})

describe('what a snapshot holds', () => {
  test('rm names its paths, from where the shell is, through its cd', () => {
    expect(plan('rm -rf dist build')?.scope).toEqual({ isTree: false, isTracked: false, isUntracked: false, paths: [`${ROOT}/build`, `${ROOT}/dist`] })
    expect(plan('rm -rf build', true, `${ROOT}/web`)?.scope.paths).toEqual([`${ROOT}/web/build`])
    expect(plan('cd web && rm -rf build')?.scope.paths).toEqual([`${ROOT}/web/build`])
    expect(plan('rm -rf ./build/*')?.scope.paths).toEqual([`${ROOT}/build`])
  })

  test('a target only known as it runs saves the whole project (git: tracked changes and untracked files)', () => {
    expect(plan('rm -rf "$OUT"')?.scope).toEqual({ isTree: true, isTracked: true, isUntracked: true, paths: [] })
    expect(plan('rm -rf "$OUT"', false)?.scope).toEqual({ isTree: true, isTracked: false, isUntracked: false, paths: [] })
    expect(plan('rm -rf **')?.scope.isTree).toBe(true)
    expect(plan('find . -name x | xargs rm -rf')?.scope.isTree).toBe(true)
    expect(plan('rm -rf .')?.scope.isTree).toBe(true)
  })

  test('git: reset and checkout save tracked changes, clean the untracked files; -x is said to be left out', () => {
    expect(plan('git reset --hard')?.scope).toEqual({ isTree: false, isTracked: true, isUntracked: false, paths: [] })
    expect(plan('git checkout -- .')?.scope.isTracked).toBe(true)
    expect(plan('git clean -fd')?.scope).toEqual({ isTree: false, isTracked: false, isUntracked: true, paths: [] })
    expect(plan('git clean -fdx')?.notes).toEqual(['ignored files (git clean -x) are not saved'])
    expect(plan('git reset --hard && git clean -fd')?.scope).toMatchObject({ isTracked: true, isUntracked: true })
  })

  test('outside the project nothing is saved, and it says where', () => {
    const p = plan('rm -rf ~/old /tmp/x')
    expect(p?.scope.paths).toEqual([])
    expect(p?.outside).toEqual([`${HOME}/old`, '/tmp/x'])
    expect(plan('git -C ../api reset --hard')?.outside).toEqual(['/work/api'])
    expect(plan('git -C ../api reset --hard')?.scope.isTracked).toBe(false)
  })

  test('a path inside another is covered by it; patterns stop at their first wildcard', () => {
    expect(outermost(['/a/b', '/a', '/a/b/c', '/d'])).toEqual(['/a', '/d'])
    expect(staticPart({ text: 'build/*/x', known: true, glob: true, raw: 'build/*/x', plain: false })).toBe('build')
    expect(staticPart({ text: '$X', known: false, glob: false, raw: '$X', plain: false })).toBeUndefined()
  })
})

describe('words', () => {
  test('scope, size and age in a few words', () => {
    expect(scopeWords({ isTree: false, isTracked: true, isUntracked: true, paths: [] }, ROOT)).toBe('tracked changes and untracked files')
    expect(scopeWords({ isTree: false, isTracked: false, isUntracked: false, paths: [`${ROOT}/a`, `${ROOT}/b`, `${ROOT}/c`, `${ROOT}/d`] }, ROOT)).toBe('a, b, c and 1 more')
    expect(scopeWords({ isTree: true, isTracked: true, isUntracked: true, paths: [] }, ROOT)).toBe('the project')
    expect([999, 42_000, 4_200_000].map(sizeWords)).toEqual(['999 B', '42 KB', '4.2 MB'])
    expect([30_000, 5 * 60_000, 3 * 3_600_000, 3 * 86_400_000].map(agoWords)).toEqual(['just now', '5m ago', '3h ago', '3d ago'])
  })

  test('a project key is stable, 16 hex digits, and does not spell the path', () => {
    expect(projectKey(ROOT)).toBe(projectKey(ROOT))
    expect(projectKey(ROOT)).toMatch(/^[0-9a-f]{16}$/)
    expect(projectKey(ROOT)).not.toBe(projectKey('/work/api'))
  })

  test('after a restore Claude is told its view is stale', () => {
    expect(restoreNote('rm -rf dist', 3)).toBe(
      'The person restored files in this project to how they were before the command `rm -rf dist` (mulligan snapshot 3). Files may differ from what you last read: re-read any file before editing it.',
    )
  })
})
