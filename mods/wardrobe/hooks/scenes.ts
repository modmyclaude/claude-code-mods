// Wallpapers: one animated scene behind the chat for each look, drawn by the
// desktop app from one SVG document, with Bolt in the look's costume in it.
// Nothing here draws by itself: register.tsx sets the backdrop with
// `$.theme.set` and answers the `Backdrop` render with the scene of the look
// that is worn.

import type { ThemeBackdropGlass } from 'claude-code'

import { dressedPixels } from './costume'
import { group, rect, svg } from './scene-kit'
import type { Scene } from './scene-kit'
import { LOOK_SCENES } from './scenes-looks'
import { SEASON_SCENES } from './scenes-seasons'
import type { Theme } from './themes'

export type { Scene }
export type SceneOf = (theme: Theme) => Scene

/** The engine's ceiling for one Svg document. */
export const SCENE_LIMIT = 131_072

const SCENES: Record<string, SceneOf> = { ...LOOK_SCENES, ...SEASON_SCENES }

/** Whether a look has a scene (every shipped look does; a theme added without one draws nothing). */
export function hasScene(theme: Pick<Theme, 'id'>): boolean {
  return Object.hasOwn(SCENES, theme.id)
}

/**
 * Bolt in the look's costume, small, at the right of the picture and off its
 * middle and its foot (where the words and the message box sit): one rect per
 * pixel, bobbing a little, the antenna light breathing.
 */
export function boltInScene(theme: Theme): { style: string; body: string } {
  const { grid } = dressedPixels(theme, 'small', 'idle')
  let body = ''
  grid.forEach((row, y) =>
    row.forEach((fill, x) => {
      if (fill === undefined) return
      const isLight = y === 0 && (x === 4 || x === 5)
      body += rect(x, y, 1, 1, fill, isLight ? { class: 'light' } : {})
    }),
  )
  const style =
    '@keyframes bolt-bob{0%,100%{transform:translate(1240px,560px) scale(12)}50%{transform:translate(1240px,554px) scale(12)}}' +
    '.bolt{transform:translate(1240px,560px) scale(12);animation:bolt-bob 4s ease-in-out infinite}' +
    '@keyframes light{0%,100%{opacity:1}50%{opacity:0.55}}.light{animation:light 3s ease-in-out infinite}'
  return { style, body: group(body, { class: 'bolt' }) }
}

/** The whole SVG document of a look's wallpaper, Bolt included; undefined for a look with no scene. */
export function sceneOf(theme: Theme): { source: string; alt: string } | undefined {
  const make = SCENES[theme.id]
  if (make === undefined) return undefined
  const scene = make(theme)
  const bolt = boltInScene(theme)
  return {
    source: svg(theme.palette.bg, scene.style + bolt.style, scene.body + bolt.body),
    alt: `${scene.alt} Bolt, in the ${theme.id} costume, stands at the right.`,
  }
}

/**
 * How the desktop frosts its panels over the scene: tinted with the look's own
 * background so the chat reads as the look, heavier for the two accessibility
 * looks so text contrast stays what their README promises.
 */
export function glassFor(theme: Theme): ThemeBackdropGlass {
  if (theme.id === 'high-contrast') return { blur: 24, tint: '#000000', opacity: 0.86 }
  if (theme.id === 'colorblind') return { blur: 20, tint: theme.palette.bg, opacity: 0.72 }
  return { blur: 14, tint: theme.palette.bg, opacity: theme.tone === 'light' ? 0.5 : 0.56 }
}

/** The scene's size in characters, for the tests. */
export function sceneSize(theme: Theme): number {
  return sceneOf(theme)?.source.length ?? 0
}
