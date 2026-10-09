// The values porthole keeps in $.state for the session (they survive a hot reload).

export type PortholeMode = 'desktop' | 'mobile'

/** One finished screenshot: a PNG Chrome wrote into a run folder the mod owns. */
export type PortholeShot = {
  file: string
  dir: string
  width: number
  height: number
  url: string
  mode: PortholeMode
  seq: number
}

/** What the pane shows. */
export type PortholeView = {
  url: string | null
  mode: PortholeMode
  phase: 'idle' | 'loading' | 'ready' | 'error'
  shot: PortholeShot | null
  error: string | null
}

/** Whether this terminal draws images: learned from the first blit after a shot. */
export type PortholeImages = 'unknown' | 'yes' | 'no'

declare module 'claude-code' {
  interface PluginState {
    porthole: {
      view: PortholeView
      lastSeen: string | null
      toasted: string[]
      images: PortholeImages
    }
  }
}
