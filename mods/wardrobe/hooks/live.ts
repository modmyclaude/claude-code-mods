// What a scene on the GPU is told of the session, as plain values: kept apart
// from the hooks so it can be tested by itself.

import type { WardrobeLive } from '../types'

/** A session nothing happens in. */
export const AT_REST: WardrobeLive = { isWorking: false }

/**
 * What the shader file is sent, under the names its `values` declares. State,
 * never a stream: the app eases the scene to it, and the shader follows the
 * pointer by itself.
 */
export const gpuValues = (now: WardrobeLive): { work: number } => ({ work: now.isWorking ? 1 : 0 })
