// The values hatchling keeps in $.state (the session's copy) and in $.store
// (the saved pet, kept across sessions and projects).

export type HatchlingSpecies =
  | 'pebblet'
  | 'fluffle'
  | 'coilsnail'
  | 'nimbit'
  | 'lampwing'
  | 'foldling'
  | 'geobug'
  | 'starwhelp'

export type HatchlingRarity = 'common' | 'uncommon' | 'rare' | 'legendary'

export type HatchlingStage = 'egg' | 'baby' | 'teen' | 'adult'

/** The one-time roll, made when the egg hatches and never again. */
export type HatchlingRoll = {
  species: HatchlingSpecies
  shiny: boolean
  /** When it hatched, ms since the epoch. */
  at: number
}

/** The saved pet: everything that survives a restart. */
export type HatchlingPet = {
  v: 1
  /** When the egg first appeared (days together count from here). */
  bornAt: number
  /** Tool calls seen while still an egg; it hatches at 25. */
  eggCalls: number
  /** Chosen with /pet name, or picked at hatch. */
  name?: string
  hatch?: HatchlingRoll
  /** Experience since hatching; the stage follows from it. */
  xp: number
  hidden: boolean
  toolCalls: number
  turns: number
  testsPassed: number
}

export type HatchlingMood =
  | 'idle'
  | 'happy'
  | 'sweat'
  | 'cheer'
  | 'sleep'
  | 'hatch'
  | 'evolve'

/** What the band is doing right now (session only). */
export type HatchlingAnim = {
  mood: HatchlingMood
  /** Frame counter; only moves while the animation timer runs. */
  tick: number
  /** Ticks left before the mood settles back (0 = it has settled). */
  left: number
  /** The one-line status under the name. */
  line: string
  /** The stage before an evolution, for the evolve flash. */
  from?: HatchlingStage
}

declare module 'claude-code' {
  interface PluginState {
    hatchling: {
      pet: HatchlingPet | null
      anim: HatchlingAnim
      working: boolean
    }
  }
}
