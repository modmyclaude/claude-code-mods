// Halftime's tests drive whole games through the engine, and alone each takes at most a few
// seconds. On a busy machine (a CI runner, several gates at once) they run many times slower,
// and the kit's 5 s per test, which is there to catch a hang, cut good runs short. Here the
// limit is a minute: a hang still fails, a loaded machine no longer does.

import { test as kitTest } from 'claude-code/testing'
import type { TestBody, TestOptions } from 'claude-code/testing'

const LIMIT_MS = 60_000

export function test(name: string, ...rest: readonly [TestBody] | readonly [TestOptions, TestBody]): void {
  const [options, body] = rest.length === 1 ? [{}, rest[0]] : rest
  kitTest(name, { timeoutMs: LIMIT_MS, ...options }, body)
}
