// The same file as last-look's hooks/paths.ts, copied so this mod installs on its own.
// Keep the two in step: a fix to one is a fix to both.

// Pure POSIX path helpers, and the alwaysAllow match.

export function isAbsolute(path: string): boolean {
  return path.startsWith('/')
}

/** Folds `.`, `..` and repeated slashes; keeps a lone `/`. */
export function normalize(path: string): string {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export function join(dir: string, path: string): string {
  return normalize(isAbsolute(path) ? path : `${dir}/${path}`)
}

/** True when `path` is `parent` or lies beneath it. */
export function within(parent: string, path: string): boolean {
  if (parent === '/') return true
  return path === parent || path.startsWith(`${parent}/`)
}

/** Moves `path` from beneath `from` to beneath `to`, or leaves it as it is. */
export function rebase(path: string, from: string, to: string): string {
  if (!within(from, path)) return path
  return normalize(to + path.slice(from.length))
}

/** How a path reads to the person: relative to where they are, else `~/...`. */
export function show(path: string, cwd: string, home?: string): string {
  if (path === cwd) return '.'
  if (within(cwd, path)) return path.slice(cwd === '/' ? 1 : cwd.length + 1)
  if (home && within(home, path)) return path === home ? '~' : `~${path.slice(home.length)}`
  return path
}

/** The alwaysAllow setting: a comma list of folders, `./` and trailing `/` dropped. */
export function parseAllow(setting: string): string[] {
  return setting
    .split(',')
    .map(entry => entry.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, ''))
    .filter(entry => entry !== '' && entry !== '.' && !entry.split('/').includes('..'))
}

/**
 * True when `path` lies inside an allowed folder: an absolute entry by
 * prefix; a relative one (`dist`, `node_modules/.cache`) as a run of folder
 * names anywhere beneath the project root, never the root itself or outside.
 */
export function isAllowed(path: string, root: string, allow: readonly string[]): boolean {
  return allow.some(entry => {
    if (isAbsolute(entry)) return within(normalize(entry), path)
    if (!within(root, path) || path === root) return false
    const segments = path.slice(root === '/' ? 1 : root.length + 1).split('/')
    const wanted = entry.split('/')
    for (let start = 0; start + wanted.length <= segments.length; start++) {
      if (wanted.every((name, k) => segments[start + k] === name)) return true
    }
    return false
  })
}

/** A glob segment (`*.log`, `b?ild`, `[ab]*`) as a RegExp, as bash matches names. */
export function globSegment(segment: string): RegExp {
  let source = ''
  for (let k = 0; k < segment.length; k++) {
    const c = segment[k] ?? ''
    if (c === '*') source += '[^/]*'
    else if (c === '?') source += '[^/]'
    else if (c === '[') {
      const close = segment.indexOf(']', k + 2)
      if (close === -1) source += '\\['
      else {
        const body = segment.slice(k + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')
        source += `[${body}]`
        k = close
      }
    } else source += c.replace(/[.+^${}()|\\\]]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

export function hasGlob(segment: string): boolean {
  return /[*?[]/.test(segment)
}
