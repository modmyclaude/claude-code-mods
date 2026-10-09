// WCAG 2.x contrast, pure. Used by the tests to hold every theme to its bar,
// and nowhere at run time (a theme is checked once, here, not per frame).

/** `#rrggbb` (or `#rgb`) to 0-255 channels; undefined for anything else. */
export function rgbOf(hex: string): [number, number, number] | undefined {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex)
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  const parts = long ? [long[1], long[2], long[3]] : short ? [short[1], short[2], short[3]].map(c => `${c}${c}`) : undefined
  if (!parts) return undefined
  const [r, g, b] = parts.map(p => parseInt(p ?? '', 16))
  return [r ?? 0, g ?? 0, b ?? 0]
}

/** Relative luminance, per WCAG 2.x: 0 for black, 1 for white. */
export function luminance(hex: string): number {
  const rgb = rgbOf(hex)
  if (!rgb) throw new Error(`not a hex colour: ${hex}`)
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** The contrast ratio of two colours, 1 to 21, whichever is lighter. */
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Hue in degrees (0-360); used to check that a diff is really blue or orange. */
export function hue(hex: string): number {
  const rgb = rgbOf(hex)
  if (!rgb) throw new Error(`not a hex colour: ${hex}`)
  const [r, g, b] = rgb.map(c => c / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
