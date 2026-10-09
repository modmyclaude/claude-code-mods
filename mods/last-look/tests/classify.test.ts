import { describe, expect, test } from 'claude-code/testing'

import { FIND_WRITES, braces, classify } from '../hooks/classify'
import type { Finding, Kind } from '../hooks/classify'

const env = { home: '/Users/me' }
const kinds = (command: string): Kind[] => classify(command, env).map(f => f.kind)
const one = (command: string): Finding => {
  const found = classify(command, env)
  expect(found.length, `one finding in: ${command}`).toBe(1)
  return found[0] as Finding
}
const texts = (f: Finding) => f.targets.map(w => w.text)
const steps = (f: Finding) => f.cd.map(s => `${s.dir.text}${s.soft ? '?' : ''}`)

// Every spelling a model writes for what the spec names.
const CAUGHT: [string, Kind[]][] = [
  ['rm -rf build', ['rm']],
  ['rm -r build', ['rm']],
  ['rm -fr build', ['rm']],
  ['rm -Rf build', ['rm']],
  ['rm -f -r build', ['rm']],
  ['rm -rfv build dist', ['rm']],
  ['rm --recursive --force build', ['rm']],
  ['rm --rec build', ['rm']],
  ['rm build -rf', ['rm']],
  ['sudo rm -rf /var/tmp/x', ['rm']],
  ['sudo -u root rm -rf x', ['rm']],
  ['sudo FOO=1 rm -rf x', ['rm']],
  ['env -i PATH=/bin rm -rf x', ['rm']],
  ['FOO=1 BAR=2 rm -rf x', ['rm']],
  ['\\rm -rf build', ['rm']],
  ['/bin/rm -rf build', ['rm']],
  ['"rm" -rf build', ['rm']],
  ['command rm -rf build', ['rm']],
  ['nohup nice -n 5 rm -rf build', ['rm']],
  ['timeout 30 rm -rf build', ['rm']],
  ['time rm -rf build', ['rm']],
  ['cd web && rm -rf build', ['rm']],
  ['npm run clean; rm -rf dist', ['rm']],
  ['ls && rm -rf dist || echo failed', ['rm']],
  ['(cd web && rm -rf build)', ['rm']],
  ['{ cd web; rm -rf build; }', ['rm']],
  ['if [ -d build ]; then rm -rf build; fi', ['rm']],
  ['for d in a b; do rm -rf "$d"; done', ['rm']],
  ['bash -c "rm -rf build"', ['rm']],
  ["sh -lc 'cd web && rm -rf .next'", ['rm']],
  ['eval rm -rf build', ['rm']],
  ['echo $(rm -rf build)', ['rm']],
  ['echo `rm -rf build`', ['rm']],
  ['rm -rf {dist,build}', ['rm']],
  ['rm -rf ~/scratch', ['rm']],
  ['rm -rf "$HOME/scratch"', ['rm']],
  ['rm -rf ./build/*', ['rm']],
  ['function clean { rm -rf build; }', ['rm']],
  ['clean() { rm -rf build; }', ['rm']],
  ['find . -name "*.pyc" -delete', ['find-delete']],
  ['find . -type d -name __pycache__ -exec rm -rf {} +', ['find-delete']],
  ['find build -name "*.map" -exec rm {} \\;', ['find-delete']],
  ['find . -name x -exec sudo rm -rf {} +', ['find-delete']],
  ['find . -name x -exec /usr/bin/env rm -rf {} \\;', ['find-delete']],
  ["find . -name x -exec sh -c 'rm -rf \"$1\"' _ {} \\;", ['find-delete']],
  ['find web -name "*.md" -fprint web/notes.md -delete', ['find-delete']],
  ["find cache -regex '.*\\.pyc' -delete", ['find-delete']],
  ['git clean -ffdx', ['git-clean']],
  ['git clean -f -f -d', ['git-clean']],
  ['rm -rf h{8..9}', ['rm']],
  ['rm -rf **/notes', ['rm']],
  ['cd -- web && rm -rf build', ['rm']],
  ['cd web & rm -rf web', ['rm']],
  ['find -delete', ['find-delete']],
  ['find . -name x | xargs rm -rf', ['xargs-rm']],
  ['find . -name "*.log" -print0 | xargs -0 rm -f', ['xargs-rm']],
  ['git clean -fd', ['git-clean']],
  ['git clean -fdx', ['git-clean']],
  ['git clean -f', ['git-clean']],
  ['git clean -xdf', ['git-clean']],
  ['git clean --force -d', ['git-clean']],
  ['git reset --hard', ['git-reset-hard']],
  ['git reset --hard HEAD~3', ['git-reset-hard']],
  ['git reset --hard origin/main', ['git-reset-hard']],
  ['git -C ../api reset --hard', ['git-reset-hard']],
  ['git checkout -- .', ['git-discard']],
  ['git checkout .', ['git-discard']],
  ['git checkout -- src/app.ts', ['git-discard']],
  ['git checkout HEAD -- src/app.ts', ['git-discard']],
  ['git checkout main src/app.ts', ['git-discard']],
  ['git checkout -f', ['git-discard']],
  ['git checkout src/app.ts', ['git-discard']],
  ['git restore .', ['git-discard']],
  ['git restore src/app.ts', ['git-discard']],
  ['git restore --staged --worktree .', ['git-discard']],
  ['git restore -SW .', ['git-discard']],
  ['git restore --source=HEAD~2 src/app.ts', ['git-discard']],
  ['git switch --discard-changes main', ['git-discard']],
  ['git push --force', ['git-push-force']],
  ['git push -f', ['git-push-force']],
  ['git push -f origin main', ['git-push-force']],
  ['git push origin main --force', ['git-push-force']],
  ['git push origin +main', ['git-push-force']],
  ['git push -fu origin feature', ['git-push-force']],
  ['git push --mirror', ['git-push-force']],
  // A lease guards nothing once --force (or -f, or +ref) is also given.
  ['git push --force --force-with-lease', ['git-push-force']],
  ['git push --force-with-lease --force', ['git-push-force']],
  ['git push -f --force-with-lease origin main', ['git-push-force']],
  ['git push --force-with-lease origin +main', ['git-push-force']],
  ['git branch -D feature', ['git-branch-delete']],
  ['git branch -D a b', ['git-branch-delete']],
  ['git branch -df feature', ['git-branch-delete']],
  ['git branch --delete --force feature', ['git-branch-delete']],
  ['git branch -d -f feature', ['git-branch-delete']],
  ['git branch --merged | xargs git branch -D', ['git-branch-delete']],
  ['echo hi > notes.txt', ['redirect']],
  ['cat config.json > backup.json', ['redirect']],
  ['npm test 2> errors.log', ['redirect']],
  ['make &> build.log', ['redirect']],
  ['echo x >| file.txt', ['redirect']],
  ['> empty.txt', ['redirect']],
  ['cd docs && echo hi > README.md', ['redirect']],
  ["cat > notes.md <<'EOF'\nhello\nEOF", ['redirect']],
  ['( npm test ) > out.txt', ['redirect']],
  ['git reset --hard && git clean -fdx', ['git-reset-hard', 'git-clean']],
  ['rm -rf a; rm -rf b', ['rm', 'rm']],
]

// Look-alikes: these must pass untouched.
const SAFE: string[] = [
  'ls -la',
  'rm file.txt',
  'rm -f file.txt',
  'rm -i a b',
  'rm -d emptydir',
  'rm -rf',
  'echo "rm -rf /"',
  "echo 'git push --force'",
  'echo rm -rf build',
  'printf "%s" "rm -rf x"',
  'grep -r TODO src',
  'grep -rf patterns.txt src',
  'git log --format="%h > %s"',
  'git commit -m "rm -rf build"',
  'git status',
  'git checkout -b feature',
  'git checkout -b feature origin/feature',
  'git checkout -',
  'git switch main',
  'git restore --staged src/app.ts',
  'git restore -p src/app.ts',
  'git reset HEAD~1',
  'git reset --soft HEAD~1',
  'git clean -n',
  'git clean -nfd',
  'git clean -fd --dry-run',
  'git clean -d',
  'git push',
  'git push origin main',
  'git push -u origin feature',
  'git push --force-with-lease',
  'git push --force-with-lease origin main',
  'git push --force-with=main origin main',
  'git push --force --dry-run',
  'git push -fn',
  'git branch -d feature',
  'git branch -D -r origin/feature',
  'git branch -D',
  'find . -name "*.ts"',
  'find . -name "-delete"',
  'find . -type f -exec grep -l TODO {} +',
  'echo hi >> notes.txt',
  'npm test 2>&1',
  'npm test > /dev/null 2>&1',
  'cmd &> /dev/null',
  'cat < input.txt',
  'cat <<< "rm -rf /"',
  "cat <<'EOF'\nrm -rf /\ngit reset --hard\nEOF",
  'cat <<-EOF\n\trm -rf /\n\tEOF',
  '# rm -rf /',
  'ls # && rm -rf /',
  '[[ "$a" > "$b" ]] && echo bigger',
  '(( count > 3 )) && echo many',
  'diff <(ls a) <(ls b)',
  'command -v rm',
  'rmdir build',
  'npm run build',
  'mv a b',
]

describe('classify', () => {
  test('catches every spelling of what the spec names', () => {
    for (const [command, expected] of CAUGHT) expect(kinds(command), command).toEqual(expected)
  })

  test('leaves the look-alikes alone', () => {
    for (const command of SAFE) expect(kinds(command), command).toEqual([])
  })

  test('rm targets resolve quotes, braces, ~ and $HOME', () => {
    expect(texts(one('rm -rf "my build" dist'))).toEqual(['my build', 'dist'])
    expect(texts(one('rm -rf {dist,build}'))).toEqual(['dist', 'build'])
    expect(texts(one('rm -rf ~/scratch'))).toEqual(['/Users/me/scratch'])
    expect(texts(one('rm -rf "$HOME/scratch"'))).toEqual(['/Users/me/scratch'])
    expect(texts(one('rm -rf -- -weird'))).toEqual(['-weird'])
  })

  test('a variable set earlier in the command is followed', () => {
    expect(texts(one('DIR=build; rm -rf "$DIR"'))).toEqual(['build'])
    const unknown = one('rm -rf "$OUT_DIR"')
    expect(unknown.targets[0]?.known).toBe(false)
  })

  test('globs are marked for the measurer to expand', () => {
    const f = one('rm -rf build/*')
    expect(f.targets[0]?.glob).toBe(true)
    expect(one('rm -rf "build/*"').targets[0]?.glob).toBe(false)
  })

  test('cd steps: && is hard, ; and || are soft, subshells do not leak', () => {
    expect(steps(one('cd web && rm -rf build'))).toEqual(['web'])
    expect(steps(one('cd web; rm -rf build'))).toEqual(['web?'])
    expect(steps(one('cd web && cd app && rm -rf build'))).toEqual(['web', 'app'])
    expect(steps(classify('(cd web && rm -rf a); rm -rf b', env)[1] as Finding)).toEqual([])
    expect(steps(one('{ cd web; }; rm -rf b'))).toEqual(['web?'])
    expect(steps(one('cd && rm -rf scratch'))).toEqual(['/Users/me'])
    expect(steps(one('git -C ../api reset --hard'))).toEqual(['../api'])
    expect(steps(one('env -C web rm -rf build'))).toEqual(['web'])
    expect(one('cd "$(mktemp -d)" && rm -rf x').cd[0]?.dir.known).toBe(false)
    // `cd --` is cd; a backgrounded cd moves only its own subshell.
    expect(steps(one('cd -- web && rm -rf build'))).toEqual(['web'])
    expect(steps(one('cd web & rm -rf web'))).toEqual([])
  })

  test('labels are the part of the command that does it', () => {
    expect(one('npm run build && rm -rf dist').label).toBe('rm -rf dist')
    expect(one('bash -c "rm -rf build"').label).toBe('rm -rf build')
  })

  test('sudo is noted', () => {
    expect(one('sudo rm -rf /opt/app').isSudo).toBe(true)
    expect(one('rm -rf build').isSudo).toBe(false)
  })

  test('find keeps a read-only listing with -delete turned into -print0', () => {
    expect(one('find . -name "*.pyc" -delete').findListing).toEqual(['.', '-depth', '-name', '*.pyc', '-print0'])
    expect(one('find src -type d -name __pycache__ -exec rm -rf {} +').findListing).toEqual(['src', '-type', 'd', '-name', '__pycache__', '-print0'])
    const busy = one('find . -name x -print -delete')
    expect(busy.findListing).toBeUndefined()
    expect(busy.unknown).toContain('does more than delete')
  })

  test('git details: refs, paths, remotes, branches', () => {
    expect(one('git reset --hard HEAD~3').git).toEqual({ sub: 'reset', ref: expect.objectContaining({ text: 'HEAD~3' }) })
    // A bare `git checkout x` may be a branch or a path: git decides, so the
    // measurer asks it (a branch passes untouched).
    expect(one('git checkout main').git).toMatchObject({ sub: 'discard', mode: 'maybe-ref' })
    const checkout = one('git checkout src/app.ts').git
    expect(checkout).toMatchObject({ sub: 'discard', mode: 'maybe-ref', fromIndex: true })
    expect(one('git checkout -- .').git).toMatchObject({ sub: 'discard', mode: 'paths', fromIndex: true })
    expect(one('git checkout HEAD -- a.ts').git).toMatchObject({ mode: 'paths', fromIndex: false })
    expect(one('git restore -SW .').git).toMatchObject({ mode: 'paths', fromIndex: false })
    expect(one('git push -f origin main').git).toMatchObject({ sub: 'push', remote: { text: 'origin' }, refspecs: [{ text: 'main' }] })
    expect(one('git branch -D a b').git).toMatchObject({ sub: 'branch', names: [{ text: 'a' }, { text: 'b' }] })
    expect(one('git clean -fdx -e .env').git).toMatchObject({ sub: 'clean', flags: ['d', 'x'], excludes: ['.env'] })
  })

  test('what cannot be known is marked, not dropped', () => {
    expect(one('find . | xargs rm').unknown).toBeDefined()
    expect(one('echo x > "$LOG"').unknown).toBeDefined()
    expect(one('git --git-dir=../x/.git reset --hard').unknown).toBeDefined()
  })

  test('never throws on broken or odd input', () => {
    for (const command of ['rm -rf "open quote', "echo 'x", 'rm -rf $(', ')))', '{{{', 'echo `', '<<', '>', 'a && && b', '\\', '$((1+', 'x'.repeat(5000)]) {
      expect(() => classify(command, env)).not.toThrow()
    }
    // An open quote still shows the rm before it.
    expect(kinds('rm -rf build "open')).toEqual(['rm'])
  })

  test('brace expansion: lists and ranges, and a cap on the work', () => {
    expect(braces('{a,b}')).toEqual(['a', 'b'])
    expect(braces('x/{a,b}/y')).toEqual(['x/a/y', 'x/b/y'])
    expect(braces('{a,b}{1,2}')).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(braces('{a}')).toEqual(['{a}'])
    expect(braces('h{8..9}')).toEqual(['h8', 'h9'])
    expect(braces('{3..1}')).toEqual(['3', '2', '1'])
    expect(braces('{a..c}')).toEqual(['a', 'b', 'c'])
    expect(braces('{a,b,c,d,e,f,g,h}{1,2,3,4,5,6,7,8,9}')).toHaveLength(72)
    // Past 256 words, or 8 nested groups, it gives up: the word is unknown, never cut short.
    expect(braces('{a,b}'.repeat(9))).toBeUndefined()
    expect(braces('{1..1000}')).toBeUndefined()
  })

  test('braces past the cap make the word unknown, so it is held unmeasured', () => {
    const f = one(`rm -rf ${'{a,b}'.repeat(9)}`)
    expect(f.targets).toHaveLength(1)
    expect(f.targets[0]?.known).toBe(false)
    expect(texts(one('rm -rf h{8..9}'))).toEqual(['h8', 'h9'])
    expect(one('rm -rf h{8..9}').targets.every(w => !w.plain)).toBe(true)
  })

  test('classifying a brace bomb stays fast; an assignment is never brace-expanded', () => {
    const started = Date.now()
    expect(kinds(`X=${'{a,b}'.repeat(40)}; rm -rf src`)).toEqual(['rm'])
    expect(kinds(`rm -rf ${'{a,b}'.repeat(40)}`)).toEqual(['rm'])
    expect(kinds(`echo ${'{a,b,c,d}'.repeat(40)}`)).toEqual([])
    expect(Date.now() - started).toBeLessThan(500)
  })

  test('an unquoted variable bash would split or glob is unknown', () => {
    expect(one('T="src cache"; rm -rf $T').targets[0]?.known).toBe(false)
    expect(one("P='*'; rm -rf $P").targets[0]?.known).toBe(false)
    expect(texts(one('T="src cache"; rm -rf "$T"'))).toEqual(['src cache'])
    expect(texts(one('T=src; rm -rf $T'))).toEqual(['src'])
  })

  test('plain marks only literal paths as written', () => {
    const plain = (command: string) => one(command).targets.map(w => w.plain)
    expect(plain('rm -rf dist "my build" ./out')).toEqual([true, true, true])
    expect(plain('rm -rf ~/dist')).toEqual([false])
    expect(plain('rm -rf "$HOME/dist"')).toEqual([false])
    expect(plain('rm -rf dist/*')).toEqual([false])
    expect(plain('rm -rf {dist,build}')).toEqual([false, false])
    expect(plain('DIR=dist; rm -rf "$DIR"')).toEqual([false])
  })

  test('no find listing ever carries a predicate that writes or runs', () => {
    const finds = [
      'find . -name "*.pyc" -delete',
      'find . -type d -name x -exec rm -rf {} +',
      'find web -name "*.md" -fprint web/notes.md -delete',
      'find web -fprint0 out -delete',
      'find web -fls out -delete',
      'find web -fprintf out "%p" -delete',
      'find . -name x -exec rm {} \\; -exec touch y \\;',
      'find . -name x -execdir rm {} + -ok rm {} \\;',
      'find . -name x -exec sudo rm -rf {} +',
      "find . -name x -exec sh -c 'rm -rf \"$1\"' _ {} \\;",
      'find . -name x -print -delete',
    ]
    for (const command of finds) {
      const f = one(command)
      for (const t of f.findListing ?? []) expect(FIND_WRITES.has(t), `${command}: ${t}`).toBe(false)
    }
    for (const writer of ['-fprint out', '-fprint0 out', '-fls out', '-fprintf out "%p"']) {
      const f = one(`find web -name "*.md" ${writer} -delete`)
      expect(f.findListing, writer).toBeUndefined()
      expect(f.unknown, writer).toBe('its find expression does more than delete, so it was not re-run to look')
    }
    expect(one("find cache -regex '.*\\.pyc' -delete").findListing).toBeUndefined()
    expect(one('find . -name x -exec sudo rm -rf {} +').findListing).toBeDefined()
  })

  test('git clean counts its forces', () => {
    expect(one('git clean -ffdx').git).toMatchObject({ sub: 'clean', forces: 2, flags: ['d', 'x'] })
    expect(one('git clean -f -f -d').git).toMatchObject({ forces: 2 })
    expect(one('git clean --force -d').git).toMatchObject({ forces: 1 })
  })
})
